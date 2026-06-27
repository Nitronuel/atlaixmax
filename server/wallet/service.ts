import { readEnv } from '../env';
import { TtlCache } from '../shared/cache';
import type {
  WalletActivity,
  WalletActivityFilter,
  WalletChain,
  WalletPortfolio
} from '../../src/features/wallet-tracker/wallet-types';
import { normalizeZerionIntelligence, type ZerionIntelligenceResponse } from './zerion-normalizer';

type ZerionPart = {
  data: unknown;
  status: number;
  error?: string;
};

type WalletIntelligenceResponse = {
  portfolio: WalletPortfolio;
  activity: WalletActivity;
};

type ActivityOptions = {
  period: string;
  kind: WalletActivityFilter | string;
  limit: number;
};

const ZERION_BASE_URL = 'https://api.zerion.io/v1';
const WALLET_CACHE_TTL_MS = 60_000;
const TRANSACTION_PAGE_LIMIT = 8;
const REQUEST_RETRY_LIMIT = 2;
const REQUEST_RETRY_DELAY_MS = 1_200;
const cache = new TtlCache();
const pending = new Map<string, Promise<WalletIntelligenceResponse>>();

const chainIds: Partial<Record<WalletChain, string>> = {
  Ethereum: 'ethereum',
  Solana: 'solana',
  Base: 'base',
  BSC: 'binance-smart-chain',
  Arbitrum: 'arbitrum',
  Optimism: 'optimism',
  Polygon: 'polygon',
  Avalanche: 'avalanche'
};

function getZerionKey() {
  return readEnv('ZERION_API_KEY', 'VITE_ZERION_API_KEY');
}

function authHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendParams(path: string, params: Record<string, string | undefined>) {
  const url = new URL(`${ZERION_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url;
}

async function readError(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return response.statusText || `Zerion request failed with ${response.status}.`;

  try {
    const parsed = JSON.parse(text) as { errors?: Array<{ detail?: string; title?: string }>; error?: string; message?: string };
    return parsed.errors?.[0]?.detail || parsed.errors?.[0]?.title || parsed.error || parsed.message || text;
  } catch {
    return text.slice(0, 240);
  }
}

async function zerionRequest(url: URL, apiKey: string, attempt = 0): Promise<ZerionPart> {
  const response = await fetch(url, {
    headers: {
      authorization: authHeader(apiKey),
      accept: 'application/json'
    }
  });

  if ((response.status === 429 || response.status === 503) && attempt < REQUEST_RETRY_LIMIT) {
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : REQUEST_RETRY_DELAY_MS * (attempt + 1));
    return zerionRequest(url, apiKey, attempt + 1);
  }

  if (response.status === 202) {
    return {
      data: null,
      status: 202,
      error: 'Zerion is indexing this wallet. Try again shortly.'
    };
  }

  if (!response.ok) {
    return {
      data: null,
      status: response.status,
      error: await readError(response)
    };
  }

  return {
    data: await response.json(),
    status: response.status
  };
}

async function zerionGet(path: string, params: Record<string, string | undefined>, apiKey: string) {
  return zerionRequest(appendParams(path, params), apiKey);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mergeTransactionPages(parts: ZerionPart[]): ZerionPart {
  const first = parts[0] || { data: { data: [] }, status: 200 };
  const rows: unknown[] = [];
  const included: unknown[] = [];
  const includedKeys = new Set<string>();

  parts.forEach((part) => {
    const body = record(part.data);
    const data = body.data;
    if (Array.isArray(data)) rows.push(...data);

    const nextIncluded = body.included;
    if (Array.isArray(nextIncluded)) {
      nextIncluded.forEach((item) => {
        const row = record(item);
        const key = `${String(row.type || '')}:${String(row.id || '')}`;
        if (includedKeys.has(key)) return;
        includedKeys.add(key);
        included.push(item);
      });
    }
  });

  const latestBody = record(parts[parts.length - 1]?.data);
  const failed = parts.find((part) => part.error);
  return {
    data: {
      ...record(first.data),
      links: latestBody.links || record(first.data).links,
      data: rows,
      included
    },
    status: failed ? failed.status : first.status,
    error: failed?.error ? `Transaction history is partial: ${failed.error}` : undefined
  };
}

async function zerionGetTransactions(path: string, params: Record<string, string | undefined>, apiKey: string) {
  const pages: ZerionPart[] = [];
  let nextUrl: URL | null = appendParams(path, params);

  for (let page = 0; page < TRANSACTION_PAGE_LIMIT && nextUrl; page += 1) {
    const part = await zerionRequest(nextUrl, apiKey);
    pages.push(part);
    if (!part.data || part.error || part.status < 200 || part.status >= 300) break;

    const next = record(record(part.data).links).next;
    if (typeof next !== 'string' || !next.startsWith(`${ZERION_BASE_URL}/`)) break;
    nextUrl = new URL(next);
    await sleep(180);
  }

  return mergeTransactionPages(pages);
}

function periodParams(period: string) {
  const now = Date.now();
  const spans: Record<string, number> = {
    '1D': 86_400_000,
    '1W': 7 * 86_400_000,
    '1M': 30 * 86_400_000
  };

  if (spans[period]) {
    const since = String(now - spans[period]);
    return {
      pnl: { since },
      transactions: { 'filter[min_mined_at]': since }
    };
  }

  if (period === '>1M') {
    const till = String(now - spans['1M']);
    return {
      pnl: { till },
      transactions: { 'filter[max_mined_at]': till }
    };
  }

  return { pnl: {}, transactions: {} };
}

function missingProvider(message: string): WalletIntelligenceResponse {
  const generatedAt = new Date().toISOString();
  return {
    portfolio: {
      netWorth: '$0.00',
      assets: [],
      providerStatus: 'provider_missing',
      message,
      generatedAt,
      tradePerformance: []
    },
    activity: {
      activities: [],
      summary: {
        lastActiveAt: 0,
        recentBuys: 0,
        recentSells: 0,
        largestMoveUsd: 0,
        largestMoveLabel: 'No activity',
        mostTradedToken: 'No token yet',
        netFlowUsd: 0
      },
      tradedTokens: [],
      providerStatus: 'provider_missing',
      message,
      generatedAt
    }
  };
}

function cacheKey(address: string, chain: WalletChain, period: string) {
  return `${address.toLowerCase()}:${chain}:${period}`;
}

function hasThrottle(body: ZerionIntelligenceResponse) {
  return [body.portfolio, body.positions, body.pnl, body.transactions].some((part) => part?.status === 429 || part?.status === 503);
}

async function loadRawIntelligence(address: string, chain: WalletChain, period: string, force: boolean, apiKey: string): Promise<ZerionIntelligenceResponse> {
  const sync = force ? 'true' : undefined;
  const chainId = chainIds[chain];
  const baseParams = { currency: 'usd', sync, 'filter[chain_ids]': chainId };
  const positionScopeParams = chain === 'Solana' ? {} : { 'filter[positions]': 'no_filter' };
  const scopedParams = periodParams(period);
  const walletPath = `/wallets/${encodeURIComponent(address)}`;

  const portfolio = await zerionGet(`${walletPath}/portfolio/`, { ...baseParams, ...positionScopeParams }, apiKey);
  await sleep(180);
  const positions = await zerionGet(`${walletPath}/positions/`, { ...baseParams, ...positionScopeParams, sort: '-value', 'page[size]': '100' }, apiKey);
  await sleep(180);
  const pnl = await zerionGet(`${walletPath}/pnl/`, { ...baseParams, ...scopedParams.pnl }, apiKey);
  await sleep(180);
  const transactions = await zerionGetTransactions(`${walletPath}/transactions/`, {
    ...baseParams,
    ...scopedParams.transactions,
    'filter[asset_types]': 'fungible',
    'page[size]': '100'
  }, apiKey);

  return {
    address,
    period,
    generatedAt: new Date().toISOString(),
    portfolio,
    positions,
    pnl,
    transactions
  };
}

function filterActivity(activity: WalletActivity, kind: WalletActivityFilter | string, limit: number) {
  const matches = kind === 'all' ? activity.activities
    : kind === 'large' ? activity.activities.filter((item) => (item.usdValue || 0) >= 10_000)
      : activity.activities.filter((item) => item.kind === kind);

  return {
    ...activity,
    activities: matches.slice(0, Math.max(10, Math.min(limit || 500, 500)))
  };
}

export class WalletPortfolioService {
  async getIntelligence(address: string, chain: WalletChain, period: string, force = false): Promise<WalletIntelligenceResponse> {
    const apiKey = getZerionKey();
    if (!apiKey) return missingProvider('Set ZERION_API_KEY in .env to load live Zerion wallet intelligence.');

    const key = cacheKey(address, chain, period);
    const cached = cache.get(key);
    if (!force && cached) return cached.value as WalletIntelligenceResponse;

    const existing = pending.get(key);
    if (!force && existing) return existing;

    const request = loadRawIntelligence(address, chain, period, force, apiKey)
      .then((raw) => {
        const normalized = normalizeZerionIntelligence(raw);
        if (!hasThrottle(raw)) {
          cache.set(key, normalized, WALLET_CACHE_TTL_MS, normalized.portfolio.generatedAt);
        }
        return normalized;
      })
      .finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }

  async getPortfolio(address: string, chain: WalletChain, period: string, force = false) {
    const intelligence = await this.getIntelligence(address, chain, period, force);
    return intelligence.portfolio;
  }

  async getActivity(address: string, chain: WalletChain, options: ActivityOptions) {
    const intelligence = await this.getIntelligence(address, chain, options.period, false);
    return filterActivity(intelligence.activity, options.kind || 'all', options.limit);
  }
}
