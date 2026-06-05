import type { OverviewEvent, OverviewFeedResponse, OverviewToken } from '../../src/shared/overview';
import { readEnv } from '../env';

type MarketCoinRow = {
  address?: string;
  chain?: string;
  ticker?: string;
  name?: string;
  price?: string;
  liquidity?: string;
  volume24h?: string;
  h24?: string;
  cap?: string;
  dexBuys?: string;
  dexSells?: string;
  dexFlow?: number;
  netFlow?: string;
  signal?: string;
  img?: string;
  pairAddress?: string;
  createdTimestamp?: number;
};

type DiscoveredTokenRow = {
  address?: string;
  chain?: string;
  ticker?: string;
  name?: string;
  price?: string;
  liquidity?: string;
  volume_24h?: string;
  last_seen_at?: string;
  raw_data?: MarketCoinRow | null;
};

const CACHE_TTL_MS = 45_000;
const STALE_TOKEN_RETENTION_DAYS = 30;
const HYDRATION_LIMIT = 700;
const MIN_FEED_VOLUME_24H_USD = 100_000;
const MIN_FEED_LIQUIDITY_USD = 100_000;
const SUPABASE_TIMEOUT_MS = 15_000;

let feedCache: { expiresAt: number; response: OverviewFeedResponse } | null = null;
const searchCache = new Map<string, { expiresAt: number; tokens: OverviewToken[] }>();

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv(
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY'
  );
  return { url: url.replace(/\/$/, ''), key };
}

function parseCompactNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;

  const cleaned = value.trim().replace(/[$,%\s,]/g, '').toUpperCase();
  if (!cleaned) return 0;

  const multiplier = cleaned.endsWith('T')
    ? 1_000_000_000_000
    : cleaned.endsWith('B')
      ? 1_000_000_000
      : cleaned.endsWith('M')
        ? 1_000_000
        : cleaned.endsWith('K')
          ? 1_000
          : 1;
  const parsed = Number(cleaned.replace(/[TBMK]$/, ''));
  return Number.isFinite(parsed) ? parsed * multiplier : 0;
}

function parsePercent(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[%+,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEvent(signal?: string): OverviewEvent {
  if (signal === 'Accumulation') return 'Accumulation';
  if (signal === 'Breakout') return 'Momentum Breakout';
  if (signal === 'Dump') return 'Market Stress';
  if (signal === 'Volume Spike') return 'Liquidity Event';
  return 'Unusual Activity';
}

function tokenKey(token: OverviewToken) {
  return `${token.chain}:${token.address || token.pairAddress}`.toLowerCase();
}

function mapRow(row: DiscoveredTokenRow): OverviewToken | null {
  const raw = row.raw_data || {};
  const address = (raw.address || row.address || '').trim();
  const chain = (raw.chain || row.chain || 'Unknown').trim();
  const symbol = (raw.ticker || row.ticker || '').trim();
  const name = (raw.name || row.name || symbol).trim();
  const pairAddress = (raw.pairAddress || '').trim();
  const liquidityUsd = parseCompactNumber(raw.liquidity || row.liquidity);
  const volume24hUsd = parseCompactNumber(raw.volume24h || row.volume_24h);

  if (!address || !symbol || liquidityUsd < MIN_FEED_LIQUIDITY_USD || volume24hUsd < MIN_FEED_VOLUME_24H_USD) {
    return null;
  }

  const dexBuys24h = Math.max(0, Math.trunc(parseCompactNumber(raw.dexBuys)));
  const dexSells24h = Math.max(0, Math.trunc(parseCompactNumber(raw.dexSells)));
  const dexFlow24h = Number.isFinite(raw.dexFlow) ? Number(raw.dexFlow) : dexBuys24h - dexSells24h;
  const dexFlowUsd24h = parseCompactNumber(raw.netFlow);

  return {
    id: `${chain}:${pairAddress || address}`.toLowerCase(),
    chain,
    dex: 'dex',
    name,
    symbol,
    address,
    pairAddress,
    url: '',
    logo: raw.img,
    priceUsd: parseCompactNumber(raw.price || row.price) || null,
    change24h: parsePercent(raw.h24),
    marketCapUsd: parseCompactNumber(raw.cap) || null,
    volume24hUsd,
    liquidityUsd,
    dexBuys24h,
    dexSells24h,
    dexFlow24h,
    dexFlowUsd24h,
    event: normalizeEvent(raw.signal),
    pairCreatedAt: Number.isFinite(raw.createdTimestamp) ? Number(raw.createdTimestamp) : null
  };
}

function rankTokens(tokens: OverviewToken[]) {
  return [...tokens].sort((left, right) => {
    const rightScore = right.volume24hUsd * 0.55 + right.liquidityUsd * 0.35 + Math.abs(right.dexFlow24h) * 250;
    const leftScore = left.volume24hUsd * 0.55 + left.liquidityUsd * 0.35 + Math.abs(left.dexFlow24h) * 250;
    return rightScore - leftScore;
  });
}

async function fetchDiscoveredTokenRows() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    throw new Error('Supabase is not configured for the overview feed.');
  }

  const cutoff = new Date(Date.now() - STALE_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const endpoint = new URL(`${url}/rest/v1/discovered_tokens`);
  endpoint.searchParams.set('select', 'address,chain,ticker,name,price,liquidity,volume_24h,last_seen_at,raw_data');
  endpoint.searchParams.set('last_seen_at', `gte.${cutoff}`);
  endpoint.searchParams.set('order', 'last_seen_at.desc');
  endpoint.searchParams.set('limit', String(HYDRATION_LIMIT));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase discovered_tokens read failed (${response.status}). ${message}`.trim());
  }

  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows as DiscoveredTokenRow[] : [];
}

function withTimeout<T>(work: Promise<T>, milliseconds: number, label: string) {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
    })
  ]);
}

async function loadDatabaseTokens() {
  const rows = await withTimeout(fetchDiscoveredTokenRows(), SUPABASE_TIMEOUT_MS + 2_000, 'Supabase discovered_tokens read');
  const byKey = new Map<string, OverviewToken>();

  rows.forEach((row) => {
    const token = mapRow(row);
    if (!token) return;
    const key = tokenKey(token);
    const current = byKey.get(key);
    if (!current || token.liquidityUsd > current.liquidityUsd) byKey.set(key, token);
  });

  return rankTokens([...byKey.values()]);
}

export async function getOverviewFeed(force = false): Promise<OverviewFeedResponse> {
  if (!force && feedCache && feedCache.expiresAt > Date.now()) return feedCache.response;

  const tokens = (await loadDatabaseTokens()).slice(0, 240);
  const response = {
    generatedAt: new Date().toISOString(),
    tokens
  };
  feedCache = { expiresAt: Date.now() + CACHE_TTL_MS, response };
  return response;
}

export async function searchOverviewTokens(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const cached = searchCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.tokens;

  const tokens = (await getOverviewFeed()).tokens
    .filter((token) => `${token.symbol} ${token.name} ${token.chain} ${token.address} ${token.pairAddress}`.toLowerCase().includes(normalized))
    .slice(0, 12);
  searchCache.set(normalized, { expiresAt: Date.now() + CACHE_TTL_MS, tokens });
  return tokens;
}
