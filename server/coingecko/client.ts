import type { CoinGeckoChartResponse, CoinGeckoCoin, CoinGeckoCoinDetails } from '../../src/shared/coingecko';
import { readEnv } from '../env';
import { classifyCoinEvent } from './events';

type CoinMarketRow = {
  id?: string;
  symbol?: string;
  name?: string;
  image?: string;
  current_price?: number | null;
  market_cap?: number | null;
  market_cap_rank?: number | null;
  fully_diluted_valuation?: number | null;
  total_volume?: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  ath?: number | null;
  ath_change_percentage?: number | null;
  atl?: number | null;
  atl_change_percentage?: number | null;
  sparkline_in_7d?: { price?: number[] };
};

type CoinDetailsPayload = CoinMarketRow & {
  description?: { en?: string };
  links?: {
    homepage?: string[];
    blockchain_site?: string[];
    official_forum_url?: string[];
    subreddit_url?: string;
    repos_url?: { github?: string[] };
    twitter_screen_name?: string;
  };
  categories?: string[];
  market_data?: {
    current_price?: { usd?: number };
    market_cap?: { usd?: number };
    fully_diluted_valuation?: { usd?: number };
    total_volume?: { usd?: number };
    price_change_percentage_1h_in_currency?: { usd?: number };
    price_change_percentage_24h_in_currency?: { usd?: number };
    price_change_percentage_7d_in_currency?: { usd?: number };
    price_change_percentage_30d_in_currency?: { usd?: number };
    circulating_supply?: number;
    total_supply?: number;
    max_supply?: number;
    ath?: { usd?: number };
    ath_change_percentage?: { usd?: number };
    atl?: { usd?: number };
    atl_change_percentage?: { usd?: number };
  };
};

type CoinGeckoSearchPayload = {
  coins?: Array<{ id?: string; name?: string; symbol?: string; market_cap_rank?: number; thumb?: string; large?: string }>;
};

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;

function apiKey() {
  return readEnv('COINGECKO_API_KEY', 'COINGECKO_DEMO_API_KEY');
}

function headers() {
  const key = apiKey();
  return {
    Accept: 'application/json',
    ...(key ? { 'x-cg-demo-api-key': key } : {})
  };
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function fetchCoinGecko<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${COINGECKO_BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal, headers: headers() });
      if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(`CoinGecko ${path} failed (${response.status}). ${message}`.trim());
      }
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'fetch failed';
  const cause = lastError instanceof Error && lastError.cause instanceof Error ? ` Cause: ${lastError.cause.message}` : '';
  throw new Error(`CoinGecko ${path} request failed after ${MAX_ATTEMPTS} attempts. ${message}.${cause}`.trim());
}

export function mapMarketRow(row: CoinMarketRow): CoinGeckoCoin | null {
  const id = row.id?.trim();
  const symbol = row.symbol?.trim().toUpperCase();
  const name = row.name?.trim();
  if (!id || !symbol || !name) return null;

  const coin: CoinGeckoCoin = {
    id,
    symbol,
    name,
    image: row.image || undefined,
    marketCapRank: numberOrNull(row.market_cap_rank),
    priceUsd: numberOrNull(row.current_price),
    marketCapUsd: numberOrNull(row.market_cap),
    fdvUsd: numberOrNull(row.fully_diluted_valuation),
    volume24hUsd: numberOrNull(row.total_volume),
    change1h: numberOrNull(row.price_change_percentage_1h_in_currency),
    change24h: numberOrNull(row.price_change_percentage_24h_in_currency),
    change7d: numberOrNull(row.price_change_percentage_7d_in_currency),
    change30d: numberOrNull(row.price_change_percentage_30d_in_currency),
    circulatingSupply: numberOrNull(row.circulating_supply),
    totalSupply: numberOrNull(row.total_supply),
    maxSupply: numberOrNull(row.max_supply),
    ath: numberOrNull(row.ath),
    athChangePercentage: numberOrNull(row.ath_change_percentage),
    atl: numberOrNull(row.atl),
    atlChangePercentage: numberOrNull(row.atl_change_percentage),
    sparkline7d: Array.isArray(row.sparkline_in_7d?.price) ? row.sparkline_in_7d.price.filter((value) => Number.isFinite(Number(value))).map(Number) : [],
    event: 'Market Watch',
    lastSeenAt: new Date().toISOString()
  };
  return { ...coin, event: classifyCoinEvent(coin) };
}

export async function fetchCoinMarkets(page = 1, perPage = 250) {
  const rows = await fetchCoinGecko<CoinMarketRow[]>('/coins/markets', {
    vs_currency: 'usd',
    order: 'market_cap_desc',
    per_page: String(perPage),
    page: String(page),
    sparkline: 'true',
    price_change_percentage: '1h,24h,7d,30d'
  });
  return rows.map(mapMarketRow).filter((coin): coin is CoinGeckoCoin => Boolean(coin));
}

function firstUrl(values?: string[]) {
  return (values || []).find((value) => /^https?:\/\//i.test(value || '')) || '';
}

function compactDescription(value?: string) {
  return (value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 520);
}

function detailLinks(payload: CoinDetailsPayload) {
  const links: Array<{ label: string; url: string }> = [];
  const homepage = firstUrl(payload.links?.homepage);
  if (homepage) links.push({ label: 'Website', url: homepage });
  const explorer = firstUrl(payload.links?.blockchain_site);
  if (explorer) links.push({ label: 'Explorer', url: explorer });
  const forum = firstUrl(payload.links?.official_forum_url);
  if (forum) links.push({ label: 'Forum', url: forum });
  if (payload.links?.subreddit_url) links.push({ label: 'Reddit', url: payload.links.subreddit_url });
  if (payload.links?.twitter_screen_name) links.push({ label: 'X', url: `https://x.com/${payload.links.twitter_screen_name}` });
  const github = firstUrl(payload.links?.repos_url?.github);
  if (github) links.push({ label: 'GitHub', url: github });
  return links.slice(0, 6);
}

export async function fetchCoinDetails(id: string): Promise<CoinGeckoCoinDetails> {
  const payload = await fetchCoinGecko<CoinDetailsPayload>(`/coins/${encodeURIComponent(id)}`, {
    localization: 'false',
    tickers: 'false',
    market_data: 'true',
    community_data: 'false',
    developer_data: 'false',
    sparkline: 'true'
  });

  const marketRow: CoinMarketRow = {
    id: payload.id,
    symbol: payload.symbol,
    name: payload.name,
    image: typeof payload.image === 'string' ? payload.image : (payload as any).image?.large,
    current_price: payload.market_data?.current_price?.usd,
    market_cap: payload.market_data?.market_cap?.usd,
    market_cap_rank: payload.market_cap_rank,
    fully_diluted_valuation: payload.market_data?.fully_diluted_valuation?.usd,
    total_volume: payload.market_data?.total_volume?.usd,
    price_change_percentage_1h_in_currency: payload.market_data?.price_change_percentage_1h_in_currency?.usd,
    price_change_percentage_24h_in_currency: payload.market_data?.price_change_percentage_24h_in_currency?.usd,
    price_change_percentage_7d_in_currency: payload.market_data?.price_change_percentage_7d_in_currency?.usd,
    price_change_percentage_30d_in_currency: payload.market_data?.price_change_percentage_30d_in_currency?.usd,
    circulating_supply: payload.market_data?.circulating_supply,
    total_supply: payload.market_data?.total_supply,
    max_supply: payload.market_data?.max_supply,
    ath: payload.market_data?.ath?.usd,
    ath_change_percentage: payload.market_data?.ath_change_percentage?.usd,
    atl: payload.market_data?.atl?.usd,
    atl_change_percentage: payload.market_data?.atl_change_percentage?.usd
  };
  const coin = mapMarketRow(marketRow);
  if (!coin) throw new Error('CoinGecko returned an invalid coin payload.');
  return {
    ...coin,
    description: compactDescription(payload.description?.en),
    homepage: firstUrl(payload.links?.homepage),
    links: detailLinks(payload),
    categories: (payload.categories || []).filter(Boolean).slice(0, 8)
  };
}

export async function fetchCoinChart(id: string, days = 7): Promise<CoinGeckoChartResponse> {
  const payload = await fetchCoinGecko<{ prices?: Array<[number, number]> }>(`/coins/${encodeURIComponent(id)}/market_chart`, {
    vs_currency: 'usd',
    days: String(days)
  });
  return {
    generatedAt: new Date().toISOString(),
    coinId: id,
    days,
    prices: (payload.prices || [])
      .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(([timestamp, price]) => ({ timestamp: Number(timestamp), price: Number(price) }))
  };
}

export async function fetchTokenContractChartRange(assetPlatformId: string, contractAddress: string, from: number, to: number): Promise<CoinGeckoChartResponse> {
  const payload = await fetchCoinGecko<{ prices?: Array<[number, number]> }>(`/coins/${encodeURIComponent(assetPlatformId)}/contract/${encodeURIComponent(contractAddress)}/market_chart/range`, {
    vs_currency: 'usd',
    from: String(Math.floor(from)),
    to: String(Math.ceil(to))
  });
  return {
    generatedAt: new Date().toISOString(),
    coinId: `${assetPlatformId}:${contractAddress.toLowerCase()}`,
    days: Math.max(1, Math.ceil((to - from) / 86_400)),
    prices: (payload.prices || [])
      .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(([timestamp, price]) => ({ timestamp: Number(timestamp), price: Number(price) }))
  };
}

export async function searchCoinGecko(query: string) {
  const payload = await fetchCoinGecko<CoinGeckoSearchPayload>('/search', { query });
  return (payload.coins || []).slice(0, 20).map((coin) => ({
    id: coin.id || '',
    symbol: (coin.symbol || '').toUpperCase(),
    name: coin.name || '',
    image: coin.large || coin.thumb || undefined,
    marketCapRank: numberOrNull(coin.market_cap_rank)
  })).filter((coin) => coin.id && coin.symbol && coin.name);
}
