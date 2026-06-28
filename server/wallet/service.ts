import { readEnv } from '../env';
import { TtlCache } from '../shared/cache';
import type {
  WalletActivity,
  WalletActivityFilter,
  WalletActivityToken,
  WalletChain,
  WalletTradePerformance,
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

type DexPair = {
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  info?: { imageUrl?: string };
};

const ZERION_BASE_URL = 'https://api.zerion.io/v1';
const DEXSCREENER_BASE_URL = 'https://api.dexscreener.com';
const BUBBLEMAPS_BASE_URL = 'https://api.bubblemaps.io';
const WALLET_CACHE_TTL_MS = 60_000;
const LOGO_CACHE_TTL_MS = 6 * 60 * 60_000;
const TRANSACTION_PAGE_LIMIT = 8;
const REQUEST_RETRY_LIMIT = 2;
const REQUEST_RETRY_DELAY_MS = 1_200;
const LOGO_LOOKUP_LIMIT = 40;
const LOGO_LOOKUP_CONCURRENCY = 4;
const cache = new TtlCache();
const logoCache = new TtlCache();
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

function getBubblemapsKey() {
  return readEnv('BUBBLEMAPS_API_KEY');
}

function getBubblemapsBaseUrl() {
  return readEnv('BUBBLEMAPS_API_BASE_URL') || BUBBLEMAPS_BASE_URL;
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function logoKey(chain: string, address: string) {
  return `${chain.toLowerCase()}:${address.toLowerCase()}`;
}

function dexScreenerChainId(chain: WalletChain | string | undefined) {
  const normalized = String(chain || '').trim().toLowerCase();
  if (['ethereum', 'eth'].includes(normalized)) return 'ethereum';
  if (['base'].includes(normalized)) return 'base';
  if (['bsc', 'binance-smart-chain', 'binance smart chain', 'bnb chain'].includes(normalized)) return 'bsc';
  if (['arbitrum', 'arb'].includes(normalized)) return 'arbitrum';
  if (['optimism', 'op'].includes(normalized)) return 'optimism';
  if (['polygon', 'matic'].includes(normalized)) return 'polygon';
  if (['avalanche', 'avax'].includes(normalized)) return 'avalanche';
  if (['solana', 'sol'].includes(normalized)) return 'solana';
  return '';
}

function bubblemapsChainId(chain: string) {
  if (chain === 'ethereum') return 'eth';
  if (['base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'solana'].includes(chain)) return chain;
  return '';
}

function scoreDexPair(pair: DexPair) {
  return Number(pair.liquidity?.usd || 0) + Number(pair.volume?.h24 || 0) * 0.1;
}

async function reachableImageUrl(url: string) {
  if (!url) return null;

  try {
    const response = await fetch(url, {
      headers: { accept: 'image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(6_000)
    });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && (contentType.startsWith('image/') || /\.(avif|gif|jpe?g|png|svg|webp)(\?|$)/iu.test(url))) return url;
  } catch {
    return null;
  }

  return null;
}

function tokenLogoFallback(symbol: string, address: string) {
  const text = (symbol.replace(/[^a-z0-9]+/giu, '').slice(0, 2) || 'T').toUpperCase();
  const hash = Array.from(`${address}:${symbol}`).reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 0);
  const hue = hash % 360;
  const accent = (hue + 38) % 360;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 72% 34%)"/><stop offset="1" stop-color="hsl(${accent} 82% 52%)"/></linearGradient></defs>`,
    '<rect width="64" height="64" rx="32" fill="url(#g)"/>',
    '<circle cx="44" cy="18" r="10" fill="rgba(255,255,255,0.18)"/>',
    `<text x="32" y="38" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${text.length === 1 ? 28 : 23}" font-weight="700" fill="#fff">${text}</text>`,
    '</svg>'
  ].join('');
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function fetchBubblemapsLogo(chain: string, address: string) {
  const apiKey = getBubblemapsKey();
  const metadataChain = bubblemapsChainId(chain);
  if (!apiKey || !metadataChain) return null;

  try {
    const response = await fetch(`${getBubblemapsBaseUrl()}/v0/tokens/metadata/${encodeURIComponent(metadataChain)}/${encodeURIComponent(address)}`, {
      headers: {
        accept: 'application/json',
        'X-ApiKey': apiKey
      },
      signal: AbortSignal.timeout(8_000)
    });

    if (response.ok) {
      const body = await response.json() as { metadata?: { img_url?: string | null } };
      return reachableImageUrl(firstString(body.metadata?.img_url));
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchDexScreenerLogo(chain: string, address: string) {
  try {
    const response = await fetch(`${DEXSCREENER_BASE_URL}/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8_000)
    });

    if (!response.ok) return null;

    const pairs = await response.json() as DexPair[];
    const addressKey = address.toLowerCase();
    const pair = pairs
      .filter((item) => firstString(item.info?.imageUrl))
      .filter((item) => String(item.baseToken?.address || '').toLowerCase() === addressKey)
      .sort((left, right) => scoreDexPair(right) - scoreDexPair(left))[0];
    return reachableImageUrl(firstString(pair?.info?.imageUrl));
  } catch {
    return null;
  }
}

async function fetchTokenLogo(chain: string, address: string) {
  const key = logoKey(chain, address);
  const cached = logoCache.get(key);
  if (cached) return cached.value as string | null;

  const logo = await fetchBubblemapsLogo(chain, address) || await fetchDexScreenerLogo(chain, address);
  logoCache.set(key, logo, LOGO_CACHE_TTL_MS);
  return logo;
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await task(item);
    }
  });

  await Promise.all(workers);
}

function setTokenLogo(token: WalletActivityToken | WalletTradePerformance['token'] | undefined, logoByAddress: Map<string, string>, logoBySymbol: Map<string, string>) {
  if (!token || token.logo) return;
  token.logo = logoByAddress.get(String(token.address || '').toLowerCase()) || logoBySymbol.get(token.symbol.toLowerCase());
}

async function enrichMissingLogos(intelligence: WalletIntelligenceResponse) {
  const missingAssets = intelligence.portfolio.assets
    .filter((asset) => !asset.logo && asset.address)
    .map((asset) => ({
      asset,
      chainId: dexScreenerChainId(asset.chain)
    }))
    .filter((item) => item.chainId)
    .slice(0, LOGO_LOOKUP_LIMIT);

  if (!missingAssets.length) return intelligence;

  const logoByAddress = new Map<string, string>();
  const logoBySymbol = new Map<string, string>();

  await mapWithConcurrency(missingAssets, LOGO_LOOKUP_CONCURRENCY, async ({ asset, chainId }) => {
    const logo = await fetchTokenLogo(chainId, asset.address) || tokenLogoFallback(asset.symbol, asset.address);
    if (!logo) return;
    asset.logo = logo;
    logoByAddress.set(asset.address.toLowerCase(), logo);
    logoBySymbol.set(asset.symbol.toLowerCase(), logo);
  });

  intelligence.portfolio.tradePerformance?.forEach((row) => setTokenLogo(row.token, logoByAddress, logoBySymbol));
  intelligence.activity.tradedTokens.forEach((token) => setTokenLogo(token, logoByAddress, logoBySymbol));
  intelligence.activity.activities.forEach((activity) => {
    setTokenLogo(activity.tokenIn, logoByAddress, logoBySymbol);
    setTokenLogo(activity.tokenOut, logoByAddress, logoBySymbol);
    activity.tokens.forEach((token) => setTokenLogo(token, logoByAddress, logoBySymbol));
  });

  return intelligence;
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
      .then(async (raw) => {
        const normalized = normalizeZerionIntelligence(raw);
        const enriched = await enrichMissingLogos(normalized);
        if (!hasThrottle(raw)) {
          cache.set(key, enriched, WALLET_CACHE_TTL_MS, enriched.portfolio.generatedAt);
        }
        return enriched;
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
