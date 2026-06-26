import type { CoinGeckoChartResponse, CoinGeckoCoin, CoinGeckoCoinDetails, CoinGeckoFeedResponse } from '../../src/shared/coingecko';
import { readEnv } from '../env';
import { acquireSystemLock, releaseSystemLock } from '../locks';
import { fetchCoinChart, fetchCoinDetails, fetchCoinMarkets, searchCoinGecko } from './client';

type CoinRow = {
  coin_id: string;
  symbol: string;
  name: string;
  image_url?: string | null;
  market_cap_rank?: number | null;
  price_usd?: number | null;
  market_cap_usd?: number | null;
  fdv_usd?: number | null;
  volume_24h_usd?: number | null;
  price_change_1h?: number | null;
  price_change_24h?: number | null;
  price_change_7d?: number | null;
  price_change_30d?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  ath?: number | null;
  ath_change_percentage?: number | null;
  atl?: number | null;
  atl_change_percentage?: number | null;
  sparkline_7d?: number[] | null;
  atlaix_event?: CoinGeckoCoin['event'] | null;
  raw_data?: CoinGeckoCoin | null;
  last_seen_at?: string;
  updated_at?: string;
};

export type CoinGeckoIngestionResponse = {
  generatedAt: string;
  scanned: number;
  stored: number;
  skipped?: boolean;
  coins: CoinGeckoCoin[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const FEED_READ_TIMEOUT_MS = 3_500;
const SUPABASE_TIMEOUT_MS = 20_000;
const COIN_FEED_LIMIT = 100;
const COIN_PAGE_SIZE = 100;
const COIN_PAGES_PER_SCAN = 1;
const COINGECKO_START_DELAY_MS = 25 * 1000;
const COINGECKO_INTERVAL_MS = 15 * 60 * 1000;
const COINGECKO_LOCK_NAME = 'coingecko_ingestion';
const COINGECKO_LOCK_TTL_SECONDS = 8 * 60;
const CHART_CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;

let feedCache: { expiresAt: number; response: CoinGeckoFeedResponse } | null = null;
let ingestionInFlight: Promise<CoinGeckoIngestionResponse> | null = null;
let feedRefreshInFlight: Promise<void> | null = null;
let schedulerStarted = false;
const detailCache = new Map<string, { expiresAt: number; coin: CoinGeckoCoinDetails }>();
const chartCache = new Map<string, { expiresAt: number; response: CoinGeckoChartResponse }>();

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

function normalizeCoinEvent(value: string): CoinGeckoCoin['event'] {
  if (value === 'Strong Momentum') return value;
  if (value === 'Volume Expansion') return value;
  if (value === 'Recovery Attempt') return value;
  if (value === 'Sell Pressure') return value;
  if (value === 'Market Leader') return value;
  if (value === 'Range Cooling') return value;
  return 'Market Watch';
}

function rowToCoin(row: CoinRow): CoinGeckoCoin {
  const raw = row.raw_data || null;
  const event = String(row.atlaix_event || raw?.event || 'Market Watch');
  return {
    id: row.coin_id,
    symbol: row.symbol,
    name: row.name,
    image: row.image_url || raw?.image,
    marketCapRank: Number(row.market_cap_rank || raw?.marketCapRank || 0) || null,
    priceUsd: row.price_usd ?? raw?.priceUsd ?? null,
    marketCapUsd: row.market_cap_usd ?? raw?.marketCapUsd ?? null,
    fdvUsd: row.fdv_usd ?? raw?.fdvUsd ?? null,
    volume24hUsd: row.volume_24h_usd ?? raw?.volume24hUsd ?? null,
    change1h: row.price_change_1h ?? raw?.change1h ?? null,
    change24h: row.price_change_24h ?? raw?.change24h ?? null,
    change7d: row.price_change_7d ?? raw?.change7d ?? null,
    change30d: row.price_change_30d ?? raw?.change30d ?? null,
    circulatingSupply: row.circulating_supply ?? raw?.circulatingSupply ?? null,
    totalSupply: row.total_supply ?? raw?.totalSupply ?? null,
    maxSupply: row.max_supply ?? raw?.maxSupply ?? null,
    ath: row.ath ?? raw?.ath ?? null,
    athChangePercentage: row.ath_change_percentage ?? raw?.athChangePercentage ?? null,
    atl: row.atl ?? raw?.atl ?? null,
    atlChangePercentage: row.atl_change_percentage ?? raw?.atlChangePercentage ?? null,
    sparkline7d: Array.isArray(row.sparkline_7d) ? row.sparkline_7d : raw?.sparkline7d || [],
    event: normalizeCoinEvent(event),
    lastSeenAt: row.last_seen_at || raw?.lastSeenAt || new Date().toISOString()
  };
}

function coinToPayload(coin: CoinGeckoCoin) {
  return {
    coin_id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    image_url: coin.image || null,
    market_cap_rank: coin.marketCapRank,
    price_usd: coin.priceUsd,
    market_cap_usd: coin.marketCapUsd,
    fdv_usd: coin.fdvUsd,
    volume_24h_usd: coin.volume24hUsd,
    price_change_1h: coin.change1h,
    price_change_24h: coin.change24h,
    price_change_7d: coin.change7d,
    price_change_30d: coin.change30d,
    circulating_supply: coin.circulatingSupply,
    total_supply: coin.totalSupply,
    max_supply: coin.maxSupply,
    ath: coin.ath,
    ath_change_percentage: coin.athChangePercentage,
    atl: coin.atl,
    atl_change_percentage: coin.atlChangePercentage,
    sparkline_7d: coin.sparkline7d,
    atlaix_event: coin.event,
    raw_data: coin,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}, timeoutMs = SUPABASE_TIMEOUT_MS): Promise<T> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for CoinGecko data.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.headers || {})
      }
    });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Supabase CoinGecko request failed (${response.status}). ${message}`.trim());
    }
    if (response.status === 204) return null as T;
    return await response.json().catch(() => null) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDatabaseCoins(timeoutMs = SUPABASE_TIMEOUT_MS) {
  const params = new URLSearchParams({
    select: '*',
    order: 'market_cap_rank.asc.nullslast',
    limit: String(COIN_FEED_LIMIT)
  });
  const rows = await supabaseFetch<CoinRow[]>(`coingecko_coins?${params.toString()}`, {}, timeoutMs);
  return (Array.isArray(rows) ? rows : []).map(rowToCoin);
}

async function upsertCoins(coins: CoinGeckoCoin[]) {
  if (!coins.length) return 0;
  const params = new URLSearchParams({ on_conflict: 'coin_id' });
  await supabaseFetch<null>(`coingecko_coins?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(coins.map(coinToPayload))
  });

  const snapshotRows = coins.map((coin) => ({
    coin_id: coin.id,
    captured_at: new Date().toISOString(),
    price_usd: coin.priceUsd,
    market_cap_usd: coin.marketCapUsd,
    volume_24h_usd: coin.volume24hUsd,
    price_change_1h: coin.change1h,
    price_change_24h: coin.change24h,
    price_change_7d: coin.change7d,
    market_cap_rank: coin.marketCapRank
  }));
  await supabaseFetch<null>('coingecko_coin_snapshots', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(snapshotRows)
  }).catch(() => null);

  feedCache = null;
  return coins.length;
}

function cacheFeed(coins: CoinGeckoCoin[]) {
  const response = { generatedAt: new Date().toISOString(), coins };
  feedCache = { expiresAt: Date.now() + CACHE_TTL_MS, response };
  return response;
}

function refreshFeedCache() {
  if (feedRefreshInFlight) return;
  feedRefreshInFlight = loadDatabaseCoins(SUPABASE_TIMEOUT_MS)
    .then((coins) => {
      cacheFeed(coins);
    })
    .catch(() => undefined)
    .finally(() => {
      feedRefreshInFlight = null;
    });
}

async function runIngestion(): Promise<CoinGeckoIngestionResponse> {
  if (ingestionInFlight) return ingestionInFlight;

  ingestionInFlight = (async () => {
    const pages = await Promise.all(
      Array.from({ length: COIN_PAGES_PER_SCAN }, (_, index) => fetchCoinMarkets(index + 1, COIN_PAGE_SIZE))
    );
    const coins = pages.flat().slice(0, COIN_FEED_LIMIT);
    const stored = await upsertCoins(coins);
    const databaseCoins = await loadDatabaseCoins().catch(() => coins);
    return {
      generatedAt: new Date().toISOString(),
      scanned: coins.length,
      stored,
      coins: databaseCoins
    };
  })().finally(() => {
    ingestionInFlight = null;
  });

  return ingestionInFlight;
}

export async function ingestCoinGeckoCoins(): Promise<CoinGeckoIngestionResponse> {
  if (ingestionInFlight) return ingestionInFlight;

  const acquired = await acquireSystemLock(COINGECKO_LOCK_NAME, COINGECKO_LOCK_TTL_SECONDS);
  if (!acquired) {
    const coins = await loadDatabaseCoins().catch(() => feedCache?.response.coins || []);
    return { generatedAt: new Date().toISOString(), scanned: 0, stored: 0, skipped: true, coins };
  }

  try {
    return await runIngestion();
  } finally {
    await releaseSystemLock(COINGECKO_LOCK_NAME).catch(() => undefined);
  }
}

export async function getCoinGeckoFeed(force = false): Promise<CoinGeckoFeedResponse> {
  if (!force && feedCache && feedCache.response.coins.length && feedCache.expiresAt > Date.now()) return feedCache.response;
  if (!force && feedCache && feedCache.response.coins.length) {
    refreshFeedCache();
    return feedCache.response;
  }

  let coins: CoinGeckoCoin[] = [];
  try {
    coins = await loadDatabaseCoins(force ? SUPABASE_TIMEOUT_MS : FEED_READ_TIMEOUT_MS);
  } catch {
    if (force) coins = (await ingestCoinGeckoCoins().catch(() => ({ coins: [] as CoinGeckoCoin[] }))).coins;
    else coins = feedCache?.response.coins || [];
  }
  if (!coins.length && !force) {
    coins = (await ingestCoinGeckoCoins().catch(() => ({ coins: [] as CoinGeckoCoin[] }))).coins;
  }
  return cacheFeed(coins);
}

export async function searchCoinGeckoCoins(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const local = (await getCoinGeckoFeed()).coins.filter((coin) => (
    `${coin.symbol} ${coin.name} ${coin.id}`.toLowerCase().includes(normalized)
  )).slice(0, 30);
  if (local.length >= 8) return local;

  const remote = await searchCoinGecko(query).catch(() => []);
  const remoteCoins = remote.map((coin) => ({
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    image: coin.image,
    marketCapRank: coin.marketCapRank,
    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    volume24hUsd: null,
    change1h: null,
    change24h: null,
    change7d: null,
    change30d: null,
    circulatingSupply: null,
    totalSupply: null,
    maxSupply: null,
    ath: null,
    athChangePercentage: null,
    atl: null,
    atlChangePercentage: null,
    sparkline7d: [],
    event: 'Market Watch' as const,
    lastSeenAt: new Date().toISOString()
  }));

  const byId = new Map<string, CoinGeckoCoin>();
  [...local, ...remoteCoins].forEach((coin) => {
    if (!byId.has(coin.id)) byId.set(coin.id, coin);
  });
  return [...byId.values()].slice(0, 30);
}

export async function getCoinGeckoCoin(id: string) {
  const coinId = id.trim().toLowerCase();
  if (!coinId) throw new Error('Coin id is required.');
  const cached = detailCache.get(coinId);
  if (cached && cached.expiresAt > Date.now()) return {
    generatedAt: new Date().toISOString(),
    coin: cached.coin
  };

  const detail = await fetchCoinDetails(coinId);
  detailCache.set(coinId, { expiresAt: Date.now() + DETAIL_CACHE_TTL_MS, coin: detail });
  return { generatedAt: new Date().toISOString(), coin: detail };
}

export async function getCoinGeckoChart(id: string, days = 7) {
  const coinId = id.trim().toLowerCase();
  if (!coinId) throw new Error('Coin id is required.');
  const normalizedDays = [1, 7, 14, 30, 90, 365].includes(days) ? days : 7;
  const cacheKey = `${coinId}:${normalizedDays}`;
  const cached = chartCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;
  const response = await fetchCoinChart(coinId, normalizedDays);
  chartCache.set(cacheKey, { expiresAt: Date.now() + CHART_CACHE_TTL_MS, response });
  return response;
}

function runScheduledIngestion() {
  void ingestCoinGeckoCoins()
    .then((response) => cacheFeed(response.coins))
    .catch((error) => {
      console.warn('[CoinGeckoIngestion] scheduled run failed.', error);
    });
}

export function startCoinGeckoIngestionScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(runScheduledIngestion, COINGECKO_START_DELAY_MS);
  setInterval(runScheduledIngestion, COINGECKO_INTERVAL_MS);
}
