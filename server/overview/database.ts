import type { OverviewEvent, OverviewFeedResponse, OverviewToken } from '../../src/shared/overview';
import { readEnv } from '../env';
import { acquireSystemLock, releaseSystemLock } from '../locks';

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
  buyVolume24h?: string;
  sellVolume24h?: string;
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

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  volume?: {
    h24?: number;
    h24Buy?: number;
    h24Sell?: number;
    buy?: number;
    sell?: number;
    buys?: number;
    sells?: number;
  };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
};

type GeckoTerminalTrade = {
  id?: string;
  attributes?: {
    tx_hash?: string;
    tx_from_address?: string;
    from_token_amount?: string;
    to_token_amount?: string;
    price_from_in_usd?: string;
    price_to_in_usd?: string;
    block_timestamp?: string;
    kind?: string;
    volume_in_usd?: string;
    from_token_address?: string;
    to_token_address?: string;
  };
};

export type OverviewTokenTrade = {
  id: string;
  kind: 'buy' | 'sell';
  timestamp: string;
  txHash: string;
  trader: string;
  tokenAmount: number | null;
  quoteAmount: number | null;
  volumeUsd: number;
  priceUsd: number | null;
  explorerUrl: string;
};

export type OverviewTokenTradesResponse = {
  generatedAt: string;
  minVolumeUsd: number;
  trades: OverviewTokenTrade[];
  source: 'geckoterminal';
};

const CACHE_TTL_MS = 60_000;
const FEED_READ_TIMEOUT_MS = 3_500;
const STALE_TOKEN_RETENTION_DAYS = 30;
const LIVE_MARKET_DATA_MAX_AGE_MS = 10 * 60 * 1000;
const HYDRATION_LIMIT = 500;
const ACTIVE_FEED_LIMIT = 100;
const MIN_FEED_VOLUME_24H_USD = 100_000;
const MIN_FEED_LIQUIDITY_USD = 100_000;
const MAX_FEED_MARKET_CAP_USD = 25_000_000_000;
const MAX_FEED_CHANGE_24H_PERCENT = 10_000;
const DISCOVERY_MIN_TXNS_24H = 25;
const FEED_MIN_SCORE = 32;
const SUPABASE_TIMEOUT_MS = 30_000;
const DEXSCREENER_SEARCH_CONCURRENCY = 5;
const SEARCH_RESULT_LIMIT = 50;
const TOKEN_DETAILS_CACHE_TTL_MS = 90 * 1000;
const OVERVIEW_INGESTION_START_DELAY_MS = 10 * 1000;
const OVERVIEW_INGESTION_INTERVAL_MS = 4 * 60 * 1000;
const EXISTING_TOKEN_REFRESH_START_DELAY_MS = 25 * 1000;
const EXISTING_TOKEN_REFRESH_INTERVAL_MS = 60 * 1000;
const EXISTING_TOKEN_REFRESH_LIMIT = 100;
const FORCE_EXISTING_TOKEN_REFRESH_LIMIT = 100;
const EXISTING_TOKEN_REFRESH_CONCURRENCY = 5;
const OVERVIEW_INGESTION_LOCK_NAME = 'overview_ingestion';
const OVERVIEW_INGESTION_LOCK_TTL_SECONDS = 5 * 60;
const OVERVIEW_REFRESH_LOCK_NAME = 'overview_existing_token_refresh';
const OVERVIEW_REFRESH_LOCK_TTL_SECONDS = 90;
const NORMAL_DISCOVERY_SEARCHES_PER_SCAN = 100;
const FORCE_DISCOVERY_SEARCHES_PER_SCAN = 120;
const DEXSCREENER_SEARCH_CACHE_TTL_MS = 3 * 60 * 1000;
const DEXSCREENER_RATE_LIMIT_COOLDOWN_MS = 45 * 1000;
const TOKEN_TRADES_CACHE_TTL_MS = 30 * 1000;
const TOKEN_TRADE_MIN_VOLUME_USD = 1_000;

let feedCache: { expiresAt: number; response: OverviewFeedResponse } | null = null;
let feedRefreshInFlight: Promise<void> | null = null;
const searchCache = new Map<string, { expiresAt: number; tokens: OverviewToken[] }>();
let lastStalePurgeAt = 0;
let lastIneligiblePurgeAt = 0;
let currentDiscoveryQueryIndex = 0;
let ingestionInFlight: Promise<OverviewIngestionResponse> | null = null;
let existingTokenRefreshInFlight: Promise<OverviewRefreshResponse> | null = null;
let ingestionSchedulerStarted = false;
let existingTokenRefreshSchedulerStarted = false;
let dexRateLimitedUntil = 0;
let existingTokenRefreshCursor = 0;

const TARGET_QUERIES = [
  'SOL', 'BASE', 'ETH', 'BSC', 'ARB', 'ARBITRUM', 'OP', 'OPTIMISM', 'POLY', 'POLYGON', 'AVAX', 'SUI', 'APT', 'SEI', 'TRON', 'TON',
  'AI', 'AGENT', 'AGENTS', 'COMPUTE', 'DATA', 'CLOUD', 'DEPIN', 'RWA', 'GAMING', 'GAME', 'BET', 'CASINO', 'INFRA', 'ROBOT', 'GPU', 'MEMEAI',
  'PEPE', 'WIF', 'BONK', 'FLOKI', 'SHIB', 'DOGE', 'MOG', 'POPCAT', 'MEW', 'BRETT', 'ANDY', 'WOLF', 'PENGU', 'FARTCOIN', 'GIGA',
  'TRUMP', 'MAGA', 'BIDEN', 'VOTE', 'USA', 'WOJAK', 'CHAD', 'SIGMA', 'BASED', 'CULT', 'VIRAL',
  'CAT', 'DOG', 'FROG', 'TOAD', 'APE', 'MONKEY', 'LION', 'TIGER', 'FISH', 'PANDA', 'SHARK', 'FOX', 'PIG', 'HAMSTER',
  'TECH', 'PROTO', 'PROTOCOL', 'SWAP', 'DEX', 'YIELD', 'FARM', 'DAO', 'GOV', 'ALPHA', 'BETA', 'INDEX', 'MEME', 'TRENDING',
  'NEIRO', 'MOODENG', 'GOAT', 'SPX', 'GNO', 'VIRTUAL', 'LUNA', 'BANK', 'AIXBT', 'MUBARAK',
  'PUMP', 'MOON', 'LAUNCH', 'EARLY', 'HOT', 'TREND', 'TRENDING NOW', 'NEW', 'FRESH',
  'JUP', 'RAY', 'JTO', 'ORCA', 'TOSHI', 'DEGEN', 'AERO', 'MFER', 'NEIROETH', 'FWOG'
];
let shuffledDiscoveryQueries = shuffleValues(TARGET_QUERIES);
const dexSearchCache = new Map<string, { expiresAt: number; pairs: DexPair[] }>();
const dexInflightSearches = new Map<string, Promise<DexPair[]>>();
const tokenDetailsCache = new Map<string, { expiresAt: number; response: OverviewTokenDetailsResponse }>();
const tokenDetailsInflight = new Map<string, Promise<OverviewTokenDetailsResponse>>();
const tokenTradesCache = new Map<string, { expiresAt: number; response: OverviewTokenTradesResponse }>();
const tokenTradesInflight = new Map<string, Promise<OverviewTokenTradesResponse>>();

export type OverviewIngestionResponse = {
  generatedAt: string;
  scannedPairs: number;
  accepted: number;
  stored: number;
  skipped?: boolean;
  tokens: OverviewToken[];
};

export type OverviewRefreshResponse = {
  generatedAt: string;
  attempted: number;
  refreshed: number;
  invalidated: number;
  failed: number;
  skipped?: boolean;
  tokens: OverviewToken[];
};

export type OverviewTokenDetailsResponse = {
  generatedAt: string;
  pair: DexPair;
  pairs: DexPair[];
  poolCount: number;
};

const STABLECOIN_SYMBOLS = new Set([
  'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDS', 'USDE', 'FDUSD', 'FRAX', 'LUSD',
  'GUSD', 'USDP', 'USDD', 'PYUSD', 'USD1', 'USDL', 'EURC', 'EURS', 'SUSD', 'MIM',
  'DOLA', 'CRVUSD', 'GHO', 'USDB', 'USDX', 'USDR', 'USDY', 'USDM', 'USDA', 'CUSD',
  'CEUR', 'JUSD', 'JUPUSD', 'USDF', 'USDF0', 'USD0', 'USDO', 'USDG', 'USN', 'UST', 'USTC'
]);

const MAJOR_ASSET_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'TRX', 'ADA', 'AVAX', 'MATIC', 'POL', 'SUI',
  'SEI', 'ARB', 'OP', 'TON', 'DOT', 'LINK', 'LTC', 'BCH', 'ATOM', 'APT', 'NEAR',
  'INJ', 'FIL', 'ETC', 'BASE', 'TRON', 'ARBITRUM', 'OPTIMISM', 'POLYGON',
  'ETHEREUM', 'BITCOIN', 'SOLANA', 'AVALANCHE'
]);

const WRAPPED_MAJOR_SYMBOLS = new Set([
  'WBTC', 'WETH', 'WSOL', 'WBNB', 'WAVAX', 'WMATIC', 'WPOL', 'WFTM', 'WTRX', 'WCORE',
  'WSEI', 'WBERA', 'WROSE', 'WONE', 'WGLMR', 'WASTR', 'WCELO', 'WETH.E', 'BTCB',
  'RENBTC', 'TBTC', 'HBTC', 'SBTC', 'CBBTC', 'CBETH', 'CBXRP', 'CBADA', 'CBSOL',
  'CBMEGA', 'SOETH', 'SOBTC', 'AXLETH', 'AXLBTC', 'AXLUSDC', 'WHETH', 'WHBTC'
]);

const LIQUID_STAKING_SYMBOLS = new Set([
  'STETH', 'WSTETH', 'RETH', 'SFRXETH', 'FRXETH', 'METH', 'EZETH', 'WEETH', 'OSETH',
  'SWETH', 'ANKRETH', 'BETH', 'WBETH', 'MSTETH', 'MSOL', 'JITOSOL', 'JUPSOL',
  'BSOL', 'INF', 'JSOL', 'STSOL', 'SCNSOL', 'LAINESOL'
]);

const MAJOR_ASSET_NAMES = new Set([
  'bitcoin', 'ethereum', 'ether', 'solana', 'bnb', 'binance coin', 'binance smart chain',
  'tron', 'arbitrum', 'base', 'optimism', 'polygon', 'avalanche', 'sui', 'sei', 'ton',
  'the open network', 'cardano', 'xrp', 'ripple', 'polkadot', 'chainlink', 'litecoin',
  'bitcoin cash', 'cosmos', 'aptos', 'near protocol', 'injective', 'filecoin', 'ethereum classic'
]);

const WRAPPED_NAME_PATTERNS = [
  /\bwrapped\b/i,
  /\bcoinbase wrapped\b/i,
  /\bbridged\b/i,
  /\bbridge\b/i,
  /\bwormhole\b/i,
  /\bbinance-peg\b/i,
  /\bbinance peg\b/i,
  /\bpegged\b/i,
  /\bportal\b/i,
  /\bwrapped ether\b/i,
  /\bwrapped btc\b/i,
  /\bwrapped bitcoin\b/i
];

const STABLE_NAME_PATTERNS = [
  /\bstablecoin\b/i,
  /\bstable coin\b/i,
  /\busd coin\b/i,
  /\btether\b/i,
  /\bpaypal usd\b/i,
  /\bsynthetic usd\b/i,
  /\bdigital dollar\b/i,
  /\busd[-\s]?backed\b/i,
  /\bdollar[-\s]?backed\b/i,
  /\bpegged usd\b/i,
  /\busd pegged\b/i,
  /\bus dollar\b/i,
  /\bu s dollar\b/i,
  /\bdai stable/i,
  /\busd stable/i,
  /\bstable usd\b/i
];

const INFRASTRUCTURE_NAME_PATTERNS = [
  /\bliquid staking\b/i,
  /\bstaked ether\b/i,
  /\bstaked sol\b/i,
  /\blp token\b/i,
  /\bliquidity pool\b/i
];

const PLACEHOLDER_IMAGE_PATTERNS = [
  /ui-avatars\.com/i,
  /avatar/i,
  /placeholder/i,
  /default/i
];

const WEAK_PROFILE_NAMES = new Set([
  'unknown',
  'loading token',
  'token',
  'new token',
  'dex token'
]);

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

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return '$0.00';
  if (Math.abs(value) >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPrice(value: unknown) {
  const numeric = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '$0.00';
  if (numeric < 0.01) return `$${numeric.toFixed(12).replace(/\.?0+$/, '')}`;
  if (numeric < 1) return `$${numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${numeric.toFixed(2)}`;
}

function getChainId(chainId?: string) {
  const normalized = (chainId || '').toLowerCase();
  if (normalized === 'solana') return 'solana';
  if (normalized === 'ethereum') return 'ethereum';
  if (normalized === 'bsc') return 'bsc';
  if (normalized === 'base') return 'base';
  if (normalized === 'polygon') return 'polygon';
  if (normalized === 'arbitrum') return 'arbitrum';
  if (normalized === 'optimism') return 'optimism';
  return normalized || 'unknown';
}

function getDexScreenerChainId(chain?: string) {
  const normalized = (chain || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['sol', 'solana'].includes(normalized)) return 'solana';
  if (['eth', 'ethereum'].includes(normalized)) return 'ethereum';
  if (['bnb', 'bsc', 'binance'].includes(normalized)) return 'bsc';
  if (['poly', 'polygon'].includes(normalized)) return 'polygon';
  if (['arb', 'arbitrum'].includes(normalized)) return 'arbitrum';
  if (['op', 'optimism'].includes(normalized)) return 'optimism';
  return normalized;
}

function getGeckoTerminalNetwork(chain?: string) {
  const normalized = getDexScreenerChainId(chain);
  if (normalized === 'ethereum') return 'eth';
  if (normalized === 'polygon') return 'polygon_pos';
  if (normalized === 'avalanche') return 'avax';
  return normalized;
}

function getTransactionExplorerUrl(chain: string, txHash: string) {
  const normalized = getDexScreenerChainId(chain);
  if (!txHash) return '';
  if (normalized === 'solana') return `https://solscan.io/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'ethereum') return `https://etherscan.io/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'base') return `https://basescan.org/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'bsc') return `https://bscscan.com/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'polygon') return `https://polygonscan.com/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'arbitrum') return `https://arbiscan.io/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'optimism') return `https://optimistic.etherscan.io/tx/${encodeURIComponent(txHash)}`;
  if (normalized === 'avalanche') return `https://snowtrace.io/tx/${encodeURIComponent(txHash)}`;
  return '';
}

function getPairAddressKey(pair: DexPair) {
  return `${getChainId(pair.chainId)}:${(pair.baseToken?.address || '').toLowerCase()}`;
}

function getPairStats(pair: DexPair) {
  const liquidity = Number(pair.liquidity?.usd || 0);
  const volume = Number(pair.volume?.h24 || 0);
  const buys = Number(pair.txns?.h24?.buys || 0);
  const sells = Number(pair.txns?.h24?.sells || 0);
  const txns = buys + sells;
  const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60) : 9999;
  const priceChange24h = Number(pair.priceChange?.h24 || 0);
  const flowRatio = txns > 0 ? buys / txns : 0.5;
  return { liquidity, volume, buys, sells, txns, ageHours, priceChange24h, flowRatio };
}

function scorePair(pair: DexPair, isExisting = false) {
  const { liquidity, volume, txns, ageHours, priceChange24h, flowRatio } = getPairStats(pair);
  const liquidityScore = Math.min(liquidity / 250_000, 8) * 8;
  const volumeScore = Math.min(volume / 100_000, 8) * 7;
  const txnScore = Math.min(txns / 100, 6) * 4;
  const ageScore = ageHours <= 24 ? 12 : ageHours <= 72 ? 9 : ageHours <= 168 ? 5 : 2;
  const momentumScore = Math.max(-8, Math.min(priceChange24h, 25)) * 0.4;
  const flowScore = Math.max(0, (flowRatio - 0.45) * 30);
  const logoScore = pair.info?.imageUrl ? 5 : 0;
  const chainScore = ['solana', 'base', 'ethereum', 'bsc'].includes(getChainId(pair.chainId)) ? 3 : 0;
  const fdv = Number(pair.fdv || 0);
  const fdvPenalty = fdv > 0 && fdv < 250_000 ? -6 : 0;
  const existingScore = isExisting ? 6 : 0;
  return liquidityScore + volumeScore + txnScore + ageScore + momentumScore + flowScore + logoScore + chainScore + existingScore + fdvPenalty;
}

function meetsDiscoveryThresholds(pair: DexPair) {
  const { liquidity, volume, txns } = getPairStats(pair);
  return liquidity >= MIN_FEED_LIQUIDITY_USD && volume >= MIN_FEED_VOLUME_24H_USD && txns >= DISCOVERY_MIN_TXNS_24H;
}

function shuffleValues<T>(values: T[]) {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const nextIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[nextIndex]] = [shuffled[nextIndex], shuffled[index]];
  }
  return shuffled;
}

function shuffleDiscoveryQueries() {
  shuffledDiscoveryQueries = shuffleValues(TARGET_QUERIES);
  currentDiscoveryQueryIndex = 0;
}

function takeDiscoveryQueries(batchSize: number, restartFromTop = false) {
  if (restartFromTop || !shuffledDiscoveryQueries.length) shuffleDiscoveryQueries();
  const queries: string[] = [];

  while (queries.length < batchSize) {
    if (currentDiscoveryQueryIndex >= shuffledDiscoveryQueries.length) shuffleDiscoveryQueries();
    queries.push(shuffledDiscoveryQueries[currentDiscoveryQueryIndex]);
    currentDiscoveryQueryIndex += 1;
  }

  return queries;
}

function isUsefulDynamicQuery(value: string) {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 24) return false;
  return /^[a-z0-9 .+-]+$/i.test(normalized);
}

function buildDynamicQueries(currentList: OverviewToken[], limit: number) {
  const ranked = [...currentList].sort((left, right) => {
    const leftScore = left.volume24hUsd + left.liquidityUsd * 0.2;
    const rightScore = right.volume24hUsd + right.liquidityUsd * 0.2;
    return rightScore - leftScore;
  });

  const dynamic = new Set<string>();
  ranked.slice(0, 35).forEach((token) => {
    const symbol = token.symbol?.trim();
    const name = token.name?.trim();
    const chain = token.chain?.trim();

    if (symbol && isUsefulDynamicQuery(symbol)) dynamic.add(symbol);
    if (name && isUsefulDynamicQuery(name)) dynamic.add(name);
    if (name) {
      const firstWord = name.split(/\s+/)[0];
      if (isUsefulDynamicQuery(firstWord)) dynamic.add(firstWord);
    }
    if (chain && isUsefulDynamicQuery(chain)) dynamic.add(chain.toUpperCase());
  });

  return [...dynamic].slice(0, limit);
}

function getDiscoveryQueries(currentList: OverviewToken[], batchSize: number, force = false) {
  const dynamicLimit = Math.min(force ? 35 : 25, Math.floor(batchSize * 0.3));
  const queries = new Set<string>();

  buildDynamicQueries(currentList, dynamicLimit).forEach((query) => queries.add(query));
  takeDiscoveryQueries(batchSize - queries.size, force).forEach((query) => queries.add(query));

  while (queries.size < batchSize) {
    takeDiscoveryQueries(1).forEach((query) => queries.add(query));
  }

  return [...queries].slice(0, batchSize);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function normalizeSymbol(value?: string) {
  return (value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizeName(value?: string) {
  return (value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function normalizeSymbolRoot(value: string) {
  return value.replace(/[^A-Z0-9]/g, '');
}

function isStablecoinSymbol(symbol: string) {
  const root = normalizeSymbolRoot(symbol);
  return (
    STABLECOIN_SYMBOLS.has(symbol) ||
    STABLECOIN_SYMBOLS.has(root) ||
    /^USD[A-Z0-9]{0,6}$/.test(root) ||
    /^[A-Z0-9]{1,5}USD$/.test(root) ||
    /^EUR[A-Z0-9]{0,6}$/.test(root) ||
    /^[A-Z0-9]{1,5}EUR$/.test(root)
  );
}

function hasReliableTokenImage(token: MarketCoinRow) {
  const image = (token.img || '').trim();
  if (!image) return false;
  if (!/^https?:\/\//i.test(image) && !image.startsWith('/')) return false;
  return !PLACEHOLDER_IMAGE_PATTERNS.some((pattern) => pattern.test(image));
}

function hasQualityTokenMetadata(token: MarketCoinRow) {
  const symbol = normalizeSymbol(token.ticker);
  const name = (token.name || '').trim();
  const normalizedName = normalizeName(name);

  if (!symbol || symbol.length > 16) return false;
  if (!name || name.length < 2 || name.length > 80) return false;
  if (WEAK_PROFILE_NAMES.has(normalizedName)) return false;
  if (!hasReliableTokenImage(token)) return false;

  return true;
}

function isExcludedAlphaToken(token: MarketCoinRow) {
  const symbol = normalizeSymbol(token.ticker);
  const name = (token.name || '').trim();
  const normalizedName = normalizeName(name);

  if (!symbol) return false;

  if (isStablecoinSymbol(symbol) || STABLE_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;

  if (
    WRAPPED_MAJOR_SYMBOLS.has(symbol) ||
    LIQUID_STAKING_SYMBOLS.has(symbol) ||
    WRAPPED_NAME_PATTERNS.some((pattern) => pattern.test(name))
  ) return true;

  if (/^(CB|AXL|WH|WORMHOLE|SO)(BTC|ETH|SOL|BNB|XRP|ADA|AVAX|MATIC|POL|USDC|USDT)$/i.test(symbol)) return true;
  if (/^W(BTC|ETH|SOL|BNB|AVAX|MATIC|POL|FTM|TRX|SEI|ROSE|ONE|CELO)$/i.test(symbol)) return true;

  if (MAJOR_ASSET_SYMBOLS.has(symbol) || MAJOR_ASSET_NAMES.has(normalizedName)) return true;
  return INFRASTRUCTURE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function hasMinimumTokenIdentity(token: MarketCoinRow) {
  const hasIdentity = Boolean(token.address && token.pairAddress && token.ticker?.trim() && token.name?.trim());
  if (!hasIdentity) return false;
  return hasQualityTokenMetadata(token);
}

function scoreMarketCoin(token: MarketCoinRow, metrics: {
  liquidityUsd: number;
  volume24hUsd: number;
  dexBuys24h: number;
  dexSells24h: number;
  change24h: number | null;
}) {
  const txns = metrics.dexBuys24h + metrics.dexSells24h;
  const flowRatio = txns > 0 ? metrics.dexBuys24h / txns : 0.5;
  const ageHours = token.createdTimestamp ? (Date.now() - token.createdTimestamp) / (1000 * 60 * 60) : 9999;
  const change24h = metrics.change24h || 0;

  const liquidityScore = Math.min(metrics.liquidityUsd / 250_000, 8) * 8;
  const volumeScore = Math.min(metrics.volume24hUsd / 100_000, 8) * 7;
  const txnScore = Math.min(txns / 100, 6) * 4;
  const ageScore = ageHours <= 24 ? 12 : ageHours <= 72 ? 9 : ageHours <= 168 ? 5 : 2;
  const momentumScore = Math.max(-8, Math.min(change24h, 25)) * 0.4;
  const flowScore = Math.max(0, (flowRatio - 0.45) * 30);
  const logoScore = hasReliableTokenImage(token) ? 5 : 0;

  return liquidityScore + volumeScore + txnScore + ageScore + momentumScore + flowScore + logoScore + 4;
}

function shouldRetainToken(token: MarketCoinRow, metrics: {
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  dexBuys24h: number;
  dexSells24h: number;
  change24h: number | null;
}) {
  if (isExcludedAlphaToken(token)) return false;
  if (!hasMinimumTokenIdentity(token)) return false;
  if (metrics.liquidityUsd < MIN_FEED_LIQUIDITY_USD || metrics.volume24hUsd < MIN_FEED_VOLUME_24H_USD) return false;
  if (metrics.dexBuys24h + metrics.dexSells24h < DISCOVERY_MIN_TXNS_24H) return false;
  if (metrics.marketCapUsd > MAX_FEED_MARKET_CAP_USD) return false;
  if (metrics.change24h !== null && Math.abs(metrics.change24h) > MAX_FEED_CHANGE_24H_PERCENT) return false;
  return scoreMarketCoin(token, metrics) >= FEED_MIN_SCORE;
}

function shouldRetainMarketRow(row: MarketCoinRow) {
  return shouldRetainToken(row, {
    marketCapUsd: parseCompactNumber(row.cap),
    liquidityUsd: parseCompactNumber(row.liquidity),
    volume24hUsd: parseCompactNumber(row.volume24h),
    dexBuys24h: Math.max(0, Math.trunc(parseCompactNumber(row.dexBuys))),
    dexSells24h: Math.max(0, Math.trunc(parseCompactNumber(row.dexSells))),
    change24h: parsePercent(row.h24)
  });
}

function normalizeEvent(signal?: string): OverviewEvent {
  if (signal === 'Accumulation') return 'Accumulation';
  if (signal === 'Breakout') return 'Momentum Breakout';
  if (signal === 'Dump') return 'Market Stress';
  if (signal === 'Volume Spike') return 'Liquidity Event';
  return 'Market Watch';
}

function tokenKey(token: OverviewToken) {
  return `${token.chain}:${token.address || token.pairAddress}`.toLowerCase();
}

function searchTokenKey(token: OverviewToken) {
  return `${token.chain}:${token.pairAddress || token.address}`.toLowerCase();
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
  const dexBuys24h = Math.max(0, Math.trunc(parseCompactNumber(raw.dexBuys)));
  const dexSells24h = Math.max(0, Math.trunc(parseCompactNumber(raw.dexSells)));
  const change24h = parsePercent(raw.h24);
  const marketCapUsd = parseCompactNumber(raw.cap);

  const normalizedRaw = {
    ...raw,
    address,
    chain,
    ticker: symbol,
    name,
    liquidity: raw.liquidity || row.liquidity,
    volume24h: raw.volume24h || row.volume_24h
  };

  if (!address || !symbol || !shouldRetainToken(normalizedRaw, {
    marketCapUsd,
    liquidityUsd,
    volume24hUsd,
    dexBuys24h,
    dexSells24h,
    change24h
  })) {
    return null;
  }

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
    change24h,
    marketCapUsd: marketCapUsd || null,
    volume24hUsd,
    liquidityUsd,
    dexBuys24h,
    dexSells24h,
    dexFlow24h,
    dexFlowUsd24h,
    event: normalizeEvent(raw.signal),
    pairCreatedAt: Number.isFinite(raw.createdTimestamp) ? Number(raw.createdTimestamp) : null,
    marketDataUpdatedAt: row.last_seen_at || null
  };
}

function mapDexPairToSearchToken(pair: DexPair): OverviewToken | null {
  const address = pair.baseToken?.address?.trim();
  const pairAddress = pair.pairAddress?.trim();
  const symbol = pair.baseToken?.symbol?.trim();
  const name = (pair.baseToken?.name || symbol || '').trim();
  const chain = getChainId(pair.chainId);

  if (!address || !pairAddress || !symbol || !name || !chain) return null;

  const volume24hUsd = Number(pair.volume?.h24 || 0);
  const dexBuys24h = Math.max(0, Math.trunc(Number(pair.txns?.h24?.buys || 0)));
  const dexSells24h = Math.max(0, Math.trunc(Number(pair.txns?.h24?.sells || 0)));
  const buyVolume24h = Number(pair.volume?.h24Buy ?? pair.volume?.buy ?? pair.volume?.buys ?? 0);
  const sellVolume24h = Number(pair.volume?.h24Sell ?? pair.volume?.sell ?? pair.volume?.sells ?? 0);

  return {
    id: `${chain}:${pairAddress}`.toLowerCase(),
    chain,
    dex: pair.dexId || 'dex',
    name,
    symbol,
    address,
    pairAddress,
    url: pair.url || '',
    logo: pair.info?.imageUrl,
    priceUsd: Number.isFinite(Number(pair.priceUsd)) ? Number(pair.priceUsd) : null,
    change24h: Number.isFinite(Number(pair.priceChange?.h24)) ? Number(pair.priceChange?.h24) : null,
    marketCapUsd: Number(pair.marketCap || pair.fdv || 0) || null,
    volume24hUsd,
    liquidityUsd: Number(pair.liquidity?.usd || 0),
    dexBuys24h,
    dexSells24h,
    dexFlow24h: dexBuys24h - dexSells24h,
    dexFlowUsd24h: buyVolume24h || sellVolume24h ? buyVolume24h - sellVolume24h : 0,
    event: normalizeEvent(undefined),
    pairCreatedAt: pair.pairCreatedAt || null,
    marketDataUpdatedAt: new Date().toISOString()
  };
}

function marketDataTime(value?: string | null) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshMarketData(value?: string | null) {
  const timestamp = marketDataTime(value);
  return timestamp > 0 && Date.now() - timestamp <= LIVE_MARKET_DATA_MAX_AGE_MS;
}

function isFreshToken(token: OverviewToken) {
  return isFreshMarketData(token.marketDataUpdatedAt);
}

function visibleFeedTokens(tokens: OverviewToken[]) {
  return tokens.filter(isFreshToken).slice(0, ACTIVE_FEED_LIMIT);
}

function feedFreshness(tokens: OverviewToken[]) {
  const timestamps = tokens
    .map((token) => marketDataTime(token.marketDataUpdatedAt))
    .filter((timestamp) => timestamp > 0);
  const oldest = timestamps.length ? Math.min(...timestamps) : 0;
  const staleCount = tokens.filter((token) => !isFreshToken(token)).length;

  return {
    freshCount: tokens.length - staleCount,
    staleCount,
    oldestMarketDataAt: oldest ? new Date(oldest).toISOString() : null,
    maxMarketDataAgeSeconds: Math.floor(LIVE_MARKET_DATA_MAX_AGE_MS / 1000)
  };
}

function getRowKey(row: DiscoveredTokenRow) {
  const raw = row.raw_data || {};
  const address = (raw.address || row.address || '').trim().toLowerCase();
  const chain = (raw.chain || row.chain || '').trim().toLowerCase();
  return address && chain ? `${chain}:${address}` : '';
}

async function deleteSupabaseRows(rows: DiscoveredTokenRow[], label: string) {
  const candidates = rows
    .map((row) => ({
      address: (row.raw_data?.address || row.address || '').trim(),
      chain: (row.raw_data?.chain || row.chain || '').trim()
    }))
    .filter((row) => row.address && row.chain);

  if (!candidates.length) return;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;

  for (const row of candidates) {
    const endpoint = new URL(`${url}/rest/v1/discovered_tokens`);
    endpoint.searchParams.set('address', `eq.${row.address}`);
    endpoint.searchParams.set('chain', `eq.${row.chain}`);

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal'
      }
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Supabase ${label} delete failed (${response.status}). ${message}`.trim());
    }
  }
}

async function deleteOverviewTokens(tokens: OverviewToken[], label: string) {
  await deleteSupabaseRows(tokens.map((token) => ({
    address: token.address,
    chain: token.chain,
    raw_data: {
      address: token.address,
      chain: token.chain,
      ticker: token.symbol,
      name: token.name,
      pairAddress: token.pairAddress
    }
  })), label);
}

async function purgeIneligibleRows(rows: DiscoveredTokenRow[], retainedKeys: Set<string>) {
  if (Date.now() - lastIneligiblePurgeAt < CACHE_TTL_MS) return;

  const ineligibleRows = rows.filter((row) => {
    const key = getRowKey(row);
    return key && !retainedKeys.has(key);
  });

  if (!ineligibleRows.length) return;
  lastIneligiblePurgeAt = Date.now();
  await deleteSupabaseRows(ineligibleRows, 'ineligible token');
}

async function purgeStaleTokens() {
  if (Date.now() - lastStalePurgeAt < CACHE_TTL_MS) return;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;

  const cutoff = new Date(Date.now() - STALE_TOKEN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const endpoint = new URL(`${url}/rest/v1/discovered_tokens`);
  endpoint.searchParams.set('last_seen_at', `lt.${cutoff}`);

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal'
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase stale token purge failed (${response.status}). ${message}`.trim());
  }

  lastStalePurgeAt = Date.now();
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

async function searchDexScreener(query: string): Promise<DexPair[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const cached = dexSearchCache.get(normalizedQuery);
  if (cached && cached.expiresAt > Date.now()) return cached.pairs;
  if (dexRateLimitedUntil > Date.now()) return [];

  const inflight = dexInflightSearches.get(normalizedQuery);
  if (inflight) return inflight;

  const endpoint = new URL('https://api.dexscreener.com/latest/dex/search');
  endpoint.searchParams.set('q', query);

  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (response.status === 429) {
        dexRateLimitedUntil = Date.now() + DEXSCREENER_RATE_LIMIT_COOLDOWN_MS;
        return [];
      }
      if (!response.ok) return [];
      const payload = await response.json().catch(() => ({}));
      const pairs = Array.isArray(payload?.pairs) ? payload.pairs as DexPair[] : [];
      dexSearchCache.set(normalizedQuery, {
        expiresAt: Date.now() + DEXSCREENER_SEARCH_CACHE_TTL_MS,
        pairs
      });
      return pairs;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
      dexInflightSearches.delete(normalizedQuery);
    }
  })();

  dexInflightSearches.set(normalizedQuery, request);
  return request;
}

async function fetchDexScreenerTokenPairs(chain: string, address: string): Promise<DexPair[]> {
  const chainId = getDexScreenerChainId(chain);
  if (!chainId || !address.trim()) return [];

  const endpoint = new URL(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address.trim())}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return [];
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload as DexPair[] : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDexScreenerPair(chain: string, pairAddress: string): Promise<DexPair | null> {
  const chainId = getDexScreenerChainId(chain);
  if (!chainId || !pairAddress.trim()) return null;

  const endpoint = new URL(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress.trim())}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => ({}));
    return payload?.pair && typeof payload.pair === 'object' ? payload.pair as DexPair : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickBestPair(pairs: DexPair[], tokenAddress: string, preferredPairAddress = '') {
  const normalizedToken = tokenAddress.trim().toLowerCase();
  const normalizedPair = preferredPairAddress.trim().toLowerCase();
  const tokenPairs = pairs.filter((pair) => {
    const base = pair.baseToken?.address?.trim().toLowerCase();
    const quote = pair.quoteToken?.address?.trim().toLowerCase();
    return base === normalizedToken || quote === normalizedToken || !normalizedToken;
  });
  const candidates = tokenPairs.length ? tokenPairs : pairs;

  if (normalizedPair) {
    const preferred = candidates.find((pair) => pair.pairAddress?.trim().toLowerCase() === normalizedPair);
    if (preferred) return preferred;
  }

  return [...candidates].sort((left, right) => Number(right.liquidity?.usd || 0) - Number(left.liquidity?.usd || 0))[0] || null;
}

function normalizeGeckoTrade(trade: GeckoTerminalTrade, chain: string, baseTokenAddress: string): OverviewTokenTrade | null {
  const attrs = trade.attributes || {};
  const txHash = String(attrs.tx_hash || '').trim();
  const volumeUsd = Number(attrs.volume_in_usd || 0);
  const kind = String(attrs.kind || '').toLowerCase() === 'sell' ? 'sell' : 'buy';
  if (!txHash || !Number.isFinite(volumeUsd) || volumeUsd < TOKEN_TRADE_MIN_VOLUME_USD) return null;

  const baseAddress = baseTokenAddress.trim().toLowerCase();
  const fromAddress = String(attrs.from_token_address || '').trim().toLowerCase();
  const toAddress = String(attrs.to_token_address || '').trim().toLowerCase();
  const fromAmount = Number(attrs.from_token_amount || 0);
  const toAmount = Number(attrs.to_token_amount || 0);
  const tokenAmount = fromAddress === baseAddress ? fromAmount : toAddress === baseAddress ? toAmount : null;
  const quoteAmount = fromAddress === baseAddress ? toAmount : toAddress === baseAddress ? fromAmount : null;
  const priceUsd = fromAddress === baseAddress
    ? Number(attrs.price_from_in_usd || 0)
    : toAddress === baseAddress
      ? Number(attrs.price_to_in_usd || 0)
      : null;

  return {
    id: String(trade.id || txHash),
    kind,
    timestamp: String(attrs.block_timestamp || ''),
    txHash,
    trader: String(attrs.tx_from_address || ''),
    tokenAmount: tokenAmount !== null && Number.isFinite(tokenAmount) ? tokenAmount : null,
    quoteAmount: quoteAmount !== null && Number.isFinite(quoteAmount) ? quoteAmount : null,
    volumeUsd,
    priceUsd: priceUsd !== null && Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
    explorerUrl: getTransactionExplorerUrl(chain, txHash)
  };
}

async function fetchGeckoTerminalTrades(chain: string, pairAddress: string, baseTokenAddress: string): Promise<OverviewTokenTrade[]> {
  const network = getGeckoTerminalNetwork(chain);
  if (!network || !pairAddress.trim() || !baseTokenAddress.trim()) return [];

  const endpoint = new URL(`https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pairAddress.trim())}/trades`);
  endpoint.searchParams.set('trade_volume_in_usd_greater_than', String(TOKEN_TRADE_MIN_VOLUME_USD));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`GeckoTerminal trades request failed with status ${response.status}.`);
    const payload = await response.json().catch(() => ({})) as { data?: GeckoTerminalTrade[] };
    return (Array.isArray(payload.data) ? payload.data : [])
      .map((trade) => normalizeGeckoTrade(trade, chain, baseTokenAddress))
      .filter((trade): trade is OverviewTokenTrade => Boolean(trade));
  } finally {
    clearTimeout(timeout);
  }
}

function mapTokenToFallbackPair(token: OverviewToken): DexPair {
  return {
    chainId: getDexScreenerChainId(token.chain) || token.chain,
    dexId: token.dex,
    url: token.url,
    pairAddress: token.pairAddress,
    baseToken: {
      address: token.address,
      name: token.name,
      symbol: token.symbol
    },
    quoteToken: { symbol: '' },
    priceUsd: token.priceUsd !== null ? String(token.priceUsd) : undefined,
    priceChange: { h24: token.change24h ?? undefined },
    liquidity: { usd: token.liquidityUsd },
    fdv: token.marketCapUsd ?? undefined,
    marketCap: token.marketCapUsd ?? undefined,
    volume: { h24: token.volume24hUsd },
    txns: {
      h24: {
        buys: token.dexBuys24h,
        sells: token.dexSells24h
      }
    },
    pairCreatedAt: token.pairCreatedAt ?? undefined,
    info: token.logo ? { imageUrl: token.logo } : undefined
  };
}

async function findFallbackTokenDetails(address: string, chain: string, preferredPairAddress = '') {
  const normalizedAddress = address.trim().toLowerCase();
  const normalizedChain = getDexScreenerChainId(chain);
  const normalizedPair = preferredPairAddress.trim().toLowerCase();
  const tokens = await loadDatabaseTokens().catch(() => feedCache?.response.tokens || []);

  return tokens.find((token) => {
    const tokenAddress = token.address.trim().toLowerCase();
    const tokenPair = token.pairAddress.trim().toLowerCase();
    const tokenChain = getDexScreenerChainId(token.chain);
    const matchesAddress = tokenAddress === normalizedAddress || tokenPair === normalizedAddress;
    const matchesChain = !normalizedChain || tokenChain === normalizedChain;
    const matchesPair = !normalizedPair || tokenPair === normalizedPair;
    return matchesAddress && matchesChain && matchesPair;
  }) || null;
}

export async function getOverviewTokenDetails(address: string, chain: string, preferredPairAddress = ''): Promise<OverviewTokenDetailsResponse> {
  const tokenAddress = address.trim();
  const chainId = getDexScreenerChainId(chain);
  if (!tokenAddress) throw new Error('Token address is required.');
  if (!chainId) throw new Error('Token chain is required.');

  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}:${preferredPairAddress.trim().toLowerCase()}`;
  const cached = tokenDetailsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const inflight = tokenDetailsInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const pairs = await fetchDexScreenerTokenPairs(chainId, tokenAddress);
    const pair = pickBestPair(pairs, tokenAddress, preferredPairAddress);
    let response: OverviewTokenDetailsResponse;
    if (!pair) {
      const pairByAddress = preferredPairAddress ? await fetchDexScreenerPair(chainId, preferredPairAddress) : null;
      if (pairByAddress) {
        response = {
          generatedAt: new Date().toISOString(),
          pair: pairByAddress,
          pairs: [pairByAddress],
          poolCount: 1
        };
      } else {
        const fallbackToken = await findFallbackTokenDetails(tokenAddress, chainId, preferredPairAddress);
        if (!fallbackToken) throw new Error('Token details were not found on DexScreener.');
        const fallbackPair = mapTokenToFallbackPair(fallbackToken);
        response = {
          generatedAt: new Date().toISOString(),
          pair: fallbackPair,
          pairs: [fallbackPair],
          poolCount: 1
        };
      }
    } else {
      response = {
        generatedAt: new Date().toISOString(),
        pair,
        pairs,
        poolCount: pairs.length
      };
    }

    tokenDetailsCache.set(cacheKey, {
      expiresAt: Date.now() + TOKEN_DETAILS_CACHE_TTL_MS,
      response
    });
    return response;
  })().finally(() => {
    tokenDetailsInflight.delete(cacheKey);
  });

  tokenDetailsInflight.set(cacheKey, request);
  return request;
}

export async function getOverviewTokenTrades(address: string, chain: string, preferredPairAddress = ''): Promise<OverviewTokenTradesResponse> {
  const tokenAddress = address.trim();
  const chainId = getDexScreenerChainId(chain);
  const pairAddress = preferredPairAddress.trim();
  if (!tokenAddress) throw new Error('Token address is required.');
  if (!chainId) throw new Error('Token chain is required.');
  if (!pairAddress) throw new Error('Pair address is required.');

  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}:${pairAddress.toLowerCase()}:${TOKEN_TRADE_MIN_VOLUME_USD}`;
  const cached = tokenTradesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.response;

  const inflight = tokenTradesInflight.get(cacheKey);
  if (inflight) return inflight;

  const request = (async () => {
    const pair = await fetchDexScreenerPair(chainId, pairAddress);
    const tradeChain = pair?.chainId || chainId;
    const baseTokenAddress = pair?.baseToken?.address || tokenAddress;
    const trades = await fetchGeckoTerminalTrades(tradeChain, pairAddress, baseTokenAddress);
    const response: OverviewTokenTradesResponse = {
      generatedAt: new Date().toISOString(),
      minVolumeUsd: TOKEN_TRADE_MIN_VOLUME_USD,
      trades,
      source: 'geckoterminal'
    };
    tokenTradesCache.set(cacheKey, {
      expiresAt: Date.now() + TOKEN_TRADES_CACHE_TTL_MS,
      response
    });
    return response;
  })().finally(() => {
    tokenTradesInflight.delete(cacheKey);
  });

  tokenTradesInflight.set(cacheKey, request);
  return request;
}

function transformPair(pair: DexPair): MarketCoinRow | null {
  const address = pair.baseToken?.address?.trim();
  const pairAddress = pair.pairAddress?.trim();
  const ticker = pair.baseToken?.symbol?.trim();
  const name = pair.baseToken?.name?.trim();
  const img = pair.info?.imageUrl?.trim();

  if (!address || !pairAddress || !ticker || !name || !img) return null;

  const buys = Number(pair.txns?.h24?.buys || 0);
  const sells = Number(pair.txns?.h24?.sells || 0);
  const totalTxns = buys + sells;
  const flowRatio = totalTxns > 0 ? buys / totalTxns : 0.5;
  const volume24h = Number(pair.volume?.h24 || 0);
  const buyVolume24h = Number(pair.volume?.h24Buy ?? pair.volume?.buy ?? pair.volume?.buys ?? 0) || volume24h * flowRatio;
  const sellVolume24h = Number(pair.volume?.h24Sell ?? pair.volume?.sell ?? pair.volume?.sells ?? 0) || Math.max(0, volume24h - buyVolume24h);
  const estimatedNetFlow = buyVolume24h - sellVolume24h;
  const ageHours = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / (1000 * 60 * 60) : 999;

  let signal: MarketCoinRow['signal'] = 'None';
  if (ageHours < 72) signal = 'Volume Spike';
  else if (Number(pair.priceChange?.h1 || 0) > 10 && totalTxns > 500) signal = 'Breakout';
  else if (buys > sells * 1.5) signal = 'Accumulation';

  return {
    address,
    chain: getChainId(pair.chainId),
    ticker,
    name,
    price: formatPrice(pair.priceUsd),
    h24: `${Number(pair.priceChange?.h24 || 0).toFixed(2)}%`,
    cap: formatCurrency(Number(pair.marketCap || pair.fdv || pair.liquidity?.usd || 0)),
    liquidity: formatCurrency(Number(pair.liquidity?.usd || 0)),
    volume24h: formatCurrency(volume24h),
    dexBuys: String(buys),
    dexSells: String(sells),
    buyVolume24h: formatCurrency(buyVolume24h),
    sellVolume24h: formatCurrency(sellVolume24h),
    dexFlow: Math.round(flowRatio * 100),
    netFlow: `${estimatedNetFlow >= 0 ? '+' : '-'}${formatCurrency(Math.abs(estimatedNetFlow))}`,
    signal,
    img,
    pairAddress,
    createdTimestamp: pair.pairCreatedAt || Date.now()
  };
}

async function upsertDiscoveredTokens(tokens: MarketCoinRow[]) {
  if (!tokens.length) return 0;

  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for overview ingestion.');

  const endpoint = new URL(`${url}/rest/v1/discovered_tokens`);
  endpoint.searchParams.set('on_conflict', 'address,chain');

  const payload = tokens.map((token) => ({
    address: token.address,
    ticker: token.ticker,
    name: token.name,
    chain: token.chain,
    price: token.price,
    liquidity: token.liquidity,
    volume_24h: token.volume24h,
    last_seen_at: new Date().toISOString(),
    raw_data: token
  }));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase discovered_tokens upsert failed (${response.status}). ${message}`.trim());
  }

  feedCache = null;
  searchCache.clear();
  return payload.length;
}

function withTimeout<T>(work: Promise<T>, milliseconds: number, label: string) {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
    })
  ]);
}

async function loadDatabaseTokens(timeoutMs = SUPABASE_TIMEOUT_MS + 2_000, options: { includeStale?: boolean } = {}) {
  const rows = await withTimeout(fetchDiscoveredTokenRows(), timeoutMs, 'Supabase discovered_tokens read');
  const byKey = new Map<string, OverviewToken>();
  const retainedRowKeys = new Set<string>();

  rows.forEach((row) => {
    const token = mapRow(row);
    if (!token) return;
    const rowKey = getRowKey(row);
    if (rowKey) retainedRowKeys.add(rowKey);
    if (!options.includeStale && !isFreshToken(token)) return;
    const key = tokenKey(token);
    const current = byKey.get(key);
    if (!current || token.liquidityUsd > current.liquidityUsd) byKey.set(key, token);
  });

  purgeStaleTokens().catch(() => undefined);
  purgeIneligibleRows(rows, retainedRowKeys).catch(() => undefined);

  return rankTokens([...byKey.values()]);
}

function cacheOverviewFeed(tokens: OverviewToken[]) {
  const liveTokens = visibleFeedTokens(tokens);
  const response = {
    generatedAt: new Date().toISOString(),
    ...feedFreshness(liveTokens),
    tokens: liveTokens
  };
  feedCache = { expiresAt: Date.now() + CACHE_TTL_MS, response };
  return response;
}

function refreshOverviewFeedCache() {
  if (feedRefreshInFlight) return;
  feedRefreshInFlight = refreshExistingOverviewTokens(false)
    .then((response) => {
      cacheOverviewFeed(response.tokens.slice(0, ACTIVE_FEED_LIMIT));
    })
    .catch(() => undefined)
    .finally(() => {
      feedRefreshInFlight = null;
    });
}

async function runOverviewIngestion(force = false): Promise<OverviewIngestionResponse> {
  if (ingestionInFlight) return ingestionInFlight;

  ingestionInFlight = (async () => {
    const existingTokens = await loadDatabaseTokens().catch(() => []);
    const existingKeys = new Set(existingTokens.map((token) => tokenKey(token)));
    const batchSize = force ? FORCE_DISCOVERY_SEARCHES_PER_SCAN : NORMAL_DISCOVERY_SEARCHES_PER_SCAN;
    const queries = getDiscoveryQueries(existingTokens, batchSize, force);
    const searchResults = await mapWithConcurrency(queries, DEXSCREENER_SEARCH_CONCURRENCY, searchDexScreener);
    const pairs = searchResults.flat();
    const accepted = new Map<string, { token: MarketCoinRow; score: number }>();

    pairs
      .filter((pair) => pair.baseToken?.address && pair.pairAddress)
      .sort((left, right) => scorePair(right, existingKeys.has(getPairAddressKey(right))) - scorePair(left, existingKeys.has(getPairAddressKey(left))))
      .forEach((pair) => {
        const key = getPairAddressKey(pair);
        const isExisting = existingKeys.has(key);
        if (!isExisting && !meetsDiscoveryThresholds(pair)) return;

        const raw = transformPair(pair);
        if (!raw) return;

        const liquidityUsd = parseCompactNumber(raw.liquidity);
        const volume24hUsd = parseCompactNumber(raw.volume24h);
        const dexBuys24h = Math.max(0, Math.trunc(parseCompactNumber(raw.dexBuys)));
        const dexSells24h = Math.max(0, Math.trunc(parseCompactNumber(raw.dexSells)));
        const marketCapUsd = parseCompactNumber(raw.cap);
        const change24h = parsePercent(raw.h24);

        if (!shouldRetainToken(raw, { marketCapUsd, liquidityUsd, volume24hUsd, dexBuys24h, dexSells24h, change24h })) return;

        const score = scoreMarketCoin(raw, { liquidityUsd, volume24hUsd, dexBuys24h, dexSells24h, change24h });
        const current = accepted.get(key);
        if (!current || score > current.score) accepted.set(key, { token: raw, score });
      });

    const acceptedTokens = [...accepted.values()]
      .filter((entry) => entry.score >= FEED_MIN_SCORE)
      .sort((left, right) => right.score - left.score)
      .slice(0, ACTIVE_FEED_LIMIT)
      .map((entry) => entry.token);

    const stored = await upsertDiscoveredTokens(acceptedTokens);
    const tokens = (await loadDatabaseTokens()).slice(0, ACTIVE_FEED_LIMIT);

    return {
      generatedAt: new Date().toISOString(),
      scannedPairs: pairs.length,
      accepted: acceptedTokens.length,
      stored,
      tokens
    };
  })().finally(() => {
    ingestionInFlight = null;
  });

  return ingestionInFlight;
}

function tokenFreshnessTime(token: OverviewToken) {
  const parsed = token.marketDataUpdatedAt ? Date.parse(token.marketDataUpdatedAt) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectExistingTokenRefreshCandidates(tokens: OverviewToken[], limit: number, force = false) {
  const eligible = tokens.filter((token) => token.pairAddress?.trim() && getDexScreenerChainId(token.chain));
  const selected = new Map<string, OverviewToken>();

  function addToken(token: OverviewToken) {
    selected.set(`${getDexScreenerChainId(token.chain)}:${token.pairAddress.trim().toLowerCase()}`, token);
  }

  [...eligible]
    .sort((left, right) => {
      const rightScore = Math.abs(Number(right.change24h || 0)) * 250_000 + right.volume24hUsd + right.liquidityUsd * 0.2;
      const leftScore = Math.abs(Number(left.change24h || 0)) * 250_000 + left.volume24hUsd + left.liquidityUsd * 0.2;
      return rightScore - leftScore;
    })
    .slice(0, force ? 45 : 25)
    .forEach(addToken);

  [...eligible]
    .sort((left, right) => tokenFreshnessTime(left) - tokenFreshnessTime(right))
    .slice(0, Math.max(0, Math.floor(limit * 0.55)))
    .forEach(addToken);

  if (eligible.length) {
    let attempts = 0;
    while (selected.size < limit && attempts < eligible.length) {
      const token = eligible[existingTokenRefreshCursor % eligible.length];
      existingTokenRefreshCursor = (existingTokenRefreshCursor + 1) % eligible.length;
      attempts += 1;
      addToken(token);
    }
  }

  return [...selected.values()].slice(0, limit);
}

async function refreshExistingOverviewTokens(force = false): Promise<OverviewRefreshResponse> {
  if (existingTokenRefreshInFlight) return existingTokenRefreshInFlight;

  const acquired = await acquireSystemLock(OVERVIEW_REFRESH_LOCK_NAME, OVERVIEW_REFRESH_LOCK_TTL_SECONDS);
  if (!acquired) {
    const tokens = (await loadDatabaseTokens().catch(() => feedCache?.response.tokens || [])).slice(0, ACTIVE_FEED_LIMIT);
    return {
      generatedAt: new Date().toISOString(),
      attempted: 0,
      refreshed: 0,
      invalidated: 0,
      failed: 0,
      skipped: true,
      tokens
    };
  }

  existingTokenRefreshInFlight = (async () => {
    const currentTokens = (await loadDatabaseTokens(SUPABASE_TIMEOUT_MS + 2_000, { includeStale: true }).catch(() => feedCache?.response.tokens || [])).slice(0, ACTIVE_FEED_LIMIT);
    const candidates = selectExistingTokenRefreshCandidates(
      currentTokens,
      force ? FORCE_EXISTING_TOKEN_REFRESH_LIMIT : EXISTING_TOKEN_REFRESH_LIMIT,
      force
    );
    const refreshResults = await mapWithConcurrency(candidates, EXISTING_TOKEN_REFRESH_CONCURRENCY, async (token) => {
      const pair = await fetchDexScreenerPair(token.chain, token.pairAddress);
      if (!pair) return { token, row: null, failed: true };
      const row = transformPair(pair);
      return { token, row, failed: false };
    });
    const refreshedRows: MarketCoinRow[] = [];
    const invalidatedTokens: OverviewToken[] = [];
    let failed = 0;

    refreshResults.forEach((result) => {
      if (result.failed) {
        failed += 1;
        return;
      }
      if (result.row && shouldRetainMarketRow(result.row)) {
        refreshedRows.push(result.row);
        return;
      }
      invalidatedTokens.push(result.token);
    });

    if (refreshedRows.length) await upsertDiscoveredTokens(refreshedRows);
    if (invalidatedTokens.length) await deleteOverviewTokens(invalidatedTokens, 'inactive refreshed token');

    const tokens = (await loadDatabaseTokens().catch(() => currentTokens)).slice(0, ACTIVE_FEED_LIMIT);
    cacheOverviewFeed(tokens);

    return {
      generatedAt: new Date().toISOString(),
      attempted: candidates.length,
      refreshed: refreshedRows.length,
      invalidated: invalidatedTokens.length,
      failed,
      tokens
    };
  })().finally(async () => {
    existingTokenRefreshInFlight = null;
    await releaseSystemLock(OVERVIEW_REFRESH_LOCK_NAME).catch(() => undefined);
  });

  return existingTokenRefreshInFlight;
}

export async function ingestOverviewTokens(force = false): Promise<OverviewIngestionResponse> {
  if (ingestionInFlight) return ingestionInFlight;

  const acquired = await acquireSystemLock(OVERVIEW_INGESTION_LOCK_NAME, OVERVIEW_INGESTION_LOCK_TTL_SECONDS);
  if (!acquired) {
    const tokens = (await loadDatabaseTokens().catch(() => feedCache?.response.tokens || [])).slice(0, ACTIVE_FEED_LIMIT);
    return {
      generatedAt: new Date().toISOString(),
      scannedPairs: 0,
      accepted: 0,
      stored: 0,
      skipped: true,
      tokens
    };
  }

  try {
    return await runOverviewIngestion(force);
  } finally {
    await releaseSystemLock(OVERVIEW_INGESTION_LOCK_NAME).catch(() => undefined);
  }
}

export async function getOverviewFeed(force = false): Promise<OverviewFeedResponse> {
  if (force) {
    try {
      const refreshed = await refreshExistingOverviewTokens(true);
      return cacheOverviewFeed(refreshed.tokens.slice(0, ACTIVE_FEED_LIMIT));
    } catch {
      feedCache = null;
    }
  }

  if (!force && feedCache && feedCache.expiresAt > Date.now()) return feedCache.response;
  if (!force && feedCache) {
    refreshOverviewFeedCache();
    return feedCache.response;
  }

  let tokens: OverviewToken[] = [];
  try {
    tokens = (await loadDatabaseTokens(force ? SUPABASE_TIMEOUT_MS + 2_000 : FEED_READ_TIMEOUT_MS)).slice(0, ACTIVE_FEED_LIMIT);
  } catch {
    tokens = feedCache?.response.tokens || [];
  }
  return cacheOverviewFeed(tokens);
}

function runScheduledOverviewIngestion() {
  void ingestOverviewTokens()
    .then((response) => {
      cacheOverviewFeed(response.tokens.slice(0, ACTIVE_FEED_LIMIT));
    })
    .catch((error) => {
      console.warn('[OverviewIngestion] scheduled run failed.', error);
    });
}

function runScheduledExistingTokenRefresh() {
  void refreshExistingOverviewTokens()
    .then((response) => {
      cacheOverviewFeed(response.tokens.slice(0, ACTIVE_FEED_LIMIT));
    })
    .catch((error) => {
      console.warn('[OverviewRefresh] scheduled run failed.', error);
    });
}

function startExistingTokenRefreshScheduler() {
  if (existingTokenRefreshSchedulerStarted) return;
  existingTokenRefreshSchedulerStarted = true;

  setTimeout(runScheduledExistingTokenRefresh, EXISTING_TOKEN_REFRESH_START_DELAY_MS);
  setInterval(runScheduledExistingTokenRefresh, EXISTING_TOKEN_REFRESH_INTERVAL_MS);
}

export function startOverviewIngestionScheduler() {
  if (ingestionSchedulerStarted) return;
  ingestionSchedulerStarted = true;

  setTimeout(runScheduledOverviewIngestion, OVERVIEW_INGESTION_START_DELAY_MS);
  setInterval(runScheduledOverviewIngestion, OVERVIEW_INGESTION_INTERVAL_MS);
  startExistingTokenRefreshScheduler();
}

export async function searchOverviewTokens(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const cached = searchCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.tokens;

  const localTokens = (await getOverviewFeed()).tokens
    .filter((token) => `${token.symbol} ${token.name} ${token.chain} ${token.address} ${token.pairAddress}`.toLowerCase().includes(normalized))
    .slice(0, SEARCH_RESULT_LIMIT);
  const remoteTokens = (await searchDexScreener(query))
    .map(mapDexPairToSearchToken)
    .filter((token): token is OverviewToken => Boolean(token));
  const byKey = new Map<string, OverviewToken>();

  [...localTokens, ...remoteTokens].forEach((token) => {
    const key = searchTokenKey(token);
    if (!byKey.has(key)) byKey.set(key, token);
  });

  const tokens = [...byKey.values()]
    .sort((left, right) => {
      const rightScore = Number(right.liquidityUsd || 0) * 0.45 + Number(right.volume24hUsd || 0) * 0.55;
      const leftScore = Number(left.liquidityUsd || 0) * 0.45 + Number(left.volume24hUsd || 0) * 0.55;
      return rightScore - leftScore;
    })
    .slice(0, SEARCH_RESULT_LIMIT);
  searchCache.set(normalized, { expiresAt: Date.now() + CACHE_TTL_MS, tokens });
  return tokens;
}
