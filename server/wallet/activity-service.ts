import { readEnv } from '../env';
import { TtlCache } from '../shared/cache';

type WalletChain = 'All Chains' | 'Ethereum' | 'Solana' | 'Base' | 'BSC' | 'Arbitrum' | 'Optimism' | 'Polygon' | 'Avalanche';
type EvmWalletChain = Exclude<WalletChain, 'All Chains' | 'Solana'>;
type WalletActivityKind = 'buy' | 'sell' | 'swap' | 'receive' | 'send' | 'approval' | 'contract' | 'unknown';
type WalletActivityConfidence = 'high' | 'medium' | 'low';
type WalletActivitySource = 'moralis_history' | 'moralis_swaps' | 'alchemy_transfers';

export type WalletActivityToken = {
  address?: string;
  symbol: string;
  name?: string;
  amount?: string;
  usdValue?: number;
  logo?: string;
};

export type WalletActivityItem = {
  id: string;
  hash: string;
  chain: WalletChain;
  kind: WalletActivityKind;
  timestamp: number;
  title: string;
  summary: string;
  tokenIn?: WalletActivityToken;
  tokenOut?: WalletActivityToken;
  tokens: WalletActivityToken[];
  usdValue?: number;
  protocol?: string;
  counterparty?: string;
  blockNumber?: string;
  explorerUrl: string;
  confidence: WalletActivityConfidence;
  source: WalletActivitySource;
};

export type WalletTradedToken = {
  address?: string;
  symbol: string;
  logo?: string;
  chain: WalletChain;
  buys: number;
  sells: number;
  swaps: number;
  receives: number;
  sends: number;
  totalUsdVolume: number;
  lastActivityAt: number;
};

export type WalletActivitySummary = {
  lastActiveAt: number;
  recentBuys: number;
  recentSells: number;
  largestMoveUsd: number;
  largestMoveLabel: string;
  mostTradedToken: string;
  netFlowUsd: number;
};

export type WalletActivityResponse = {
  activities: WalletActivityItem[];
  summary: WalletActivitySummary;
  tradedTokens: WalletTradedToken[];
  providerStatus: 'ready' | 'provider_missing' | 'partial' | 'error';
  message?: string;
  generatedAt: string;
};

type ActivityOptions = {
  period: string;
  kind: string;
  limit: number;
};

type MoralisHistoryRow = Record<string, unknown>;
type MoralisSwapRow = Record<string, unknown>;
type AlchemyTransfer = {
  hash?: string;
  blockNum?: string;
  from?: string;
  to?: string;
  value?: number | string;
  asset?: string;
  category?: string;
  rawContract?: {
    address?: string;
    decimal?: string;
  };
  metadata?: {
    blockTimestamp?: string;
  };
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    message?: string;
  };
};

const WALLET_ACTIVITY_CACHE_TTL_MS = 45_000;
const WALLET_ACTIVITY_LIMIT = 500;
const PROVIDER_PAGE_SIZE = 100;
const MAX_PROVIDER_PAGES = 5;
const ACTIVITY_PRICE_ENRICHMENT_LIMIT = 80;
const ACTIVITY_PRICE_CACHE_TTL_MS = 6 * 60 * 60_000;
const MORALIS_EVM_BASE_URL = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_SOLANA_BASE_URL = 'https://solana-gateway.moralis.io';
const cache = new TtlCache();
const priceCache = new TtlCache();
const pending = new Map<string, Promise<WalletActivityResponse>>();

const evmChainMap: Record<EvmWalletChain, { moralis: string; alchemy?: string; explorer: string; nativeSymbol: string; wrappedNative: string }> = {
  Ethereum: { moralis: 'eth', alchemy: 'eth-mainnet', explorer: 'https://etherscan.io/tx/', nativeSymbol: 'ETH', wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  Base: { moralis: 'base', alchemy: 'base-mainnet', explorer: 'https://basescan.org/tx/', nativeSymbol: 'ETH', wrappedNative: '0x4200000000000000000000000000000000000006' },
  BSC: { moralis: 'bsc', explorer: 'https://bscscan.com/tx/', nativeSymbol: 'BNB', wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  Arbitrum: { moralis: 'arbitrum', alchemy: 'arb-mainnet', explorer: 'https://arbiscan.io/tx/', nativeSymbol: 'ETH', wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
  Optimism: { moralis: 'optimism', alchemy: 'opt-mainnet', explorer: 'https://optimistic.etherscan.io/tx/', nativeSymbol: 'ETH', wrappedNative: '0x4200000000000000000000000000000000000006' },
  Polygon: { moralis: 'polygon', alchemy: 'polygon-mainnet', explorer: 'https://polygonscan.com/tx/', nativeSymbol: 'MATIC', wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' },
  Avalanche: { moralis: 'avalanche', explorer: 'https://snowtrace.io/tx/', nativeSymbol: 'AVAX', wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' }
};

const evmAggregateChains: EvmWalletChain[] = ['Ethereum', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'];
const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'USDS', 'TUSD']);
const NATIVE_ADDRESSES = new Set(['native', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']);

function getMoralisKey() {
  return readEnv('MORALIS_API_KEY', 'VITE_MORALIS_KEY', 'VITE_MORALIS_API_KEY');
}

function getAlchemyKey() {
  return readEnv('ALCHEMY_API_KEY', 'VITE_ALCHEMY_KEY', 'VITE_ALCHEMY_API_KEY');
}

function periodStart(period: string) {
  if (period === '1D') return Date.now() - 86_400_000;
  if (period === '1W') return Date.now() - 7 * 86_400_000;
  if (period === '1M') return Date.now() - 30 * 86_400_000;
  if (period === '>1M') return 0;
  return 0;
}

function parseTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function activityBlockNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
    if (typeof value === 'string' && value.trim()) {
      if (value.startsWith('0x')) {
        try {
          return BigInt(value).toString();
        } catch {
          return '';
        }
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return String(Math.trunc(parsed));
    }
  }
  return '';
}

function parseTokenAmount(value?: string) {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

function tokenPriceAddress(token: WalletActivityToken, chain: WalletChain) {
  if (chain === 'Solana') return token.address || '';
  if (!(chain in evmChainMap)) return token.address || '';
  const address = (token.address || '').toLowerCase();
  const nativeSymbol = evmChainMap[chain as EvmWalletChain].nativeSymbol.toUpperCase();
  if (!address || NATIVE_ADDRESSES.has(address) || token.symbol.toUpperCase() === nativeSymbol) {
    return evmChainMap[chain as EvmWalletChain].wrappedNative;
  }
  return token.address || '';
}

function priceCacheKey(chain: WalletChain, address: string, blockNumber?: string, timestamp?: number) {
  const timeBucket = timestamp ? Math.floor(timestamp / 3_600_000) : 0;
  return `${chain}:${address.toLowerCase()}:${blockNumber || timeBucket}`;
}

function shortHash(hash: string) {
  return hash.length > 12 ? `${hash.slice(0, 6)}...${hash.slice(-4)}` : hash;
}

function tokenLabel(token: WalletActivityToken | undefined) {
  return token?.symbol || token?.name || 'token';
}

function explorerUrl(chain: EvmWalletChain, hash: string) {
  return hash ? `${evmChainMap[chain].explorer}${hash}` : '';
}

function solanaExplorerUrl(hash: string) {
  return hash ? `https://solscan.io/tx/${hash}` : '';
}

async function fetchJson<T>(url: string, headers: Record<string, string>, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...headers, ...(init?.headers || {}) } });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function moralisJson<T>(url: string) {
  const apiKey = getMoralisKey();
  if (!apiKey) throw new Error('Moralis API key is missing.');
  return fetchJson<T>(url, { 'X-API-Key': apiKey });
}

async function fetchMoralisDateToBlock(chain: EvmWalletChain, timestampMs: number) {
  if (!getMoralisKey() || !timestampMs) return '';
  const cacheKey = `date-to-block:${chain}:${Math.floor(timestampMs / 3_600_000)}`;
  const cached = priceCache.get(cacheKey);
  if (cached) return String(cached.value || '');

  const url = new URL(`${MORALIS_EVM_BASE_URL}/dateToBlock`);
  url.searchParams.set('chain', evmChainMap[chain].moralis);
  url.searchParams.set('date', new Date(timestampMs).toISOString());

  try {
    const data = await moralisJson<{ block?: number | string; block_number?: number | string }>(url.toString());
    const block = activityBlockNumber(data.block ?? data.block_number);
    priceCache.set(cacheKey, block, ACTIVITY_PRICE_CACHE_TTL_MS);
    return block;
  } catch {
    priceCache.set(cacheKey, '', 10 * 60_000);
    return '';
  }
}

async function fetchMoralisActivityPrice(address: string, chain: WalletChain, blockNumber?: string, timestamp?: number) {
  if (!getMoralisKey() || !address) return 0;
  const normalizedBlock = chain !== 'Solana' && !blockNumber && timestamp && chain in evmChainMap
    ? await fetchMoralisDateToBlock(chain as EvmWalletChain, timestamp)
    : blockNumber;
  const cacheKey = priceCacheKey(chain, address, normalizedBlock, timestamp);
  const cached = priceCache.get(cacheKey);
  if (cached) return Number(cached.value || 0);

  const isSolana = chain === 'Solana';
  if (!isSolana && !(chain in evmChainMap)) return 0;
  const url = new URL(isSolana
    ? `${MORALIS_SOLANA_BASE_URL}/token/mainnet/${address}/price`
    : `${MORALIS_EVM_BASE_URL}/erc20/${address}/price`);
  if (!isSolana) url.searchParams.set('chain', evmChainMap[chain as EvmWalletChain].moralis);
  if (normalizedBlock && !isSolana) url.searchParams.set('to_block', normalizedBlock);
  if (timestamp && isSolana) url.searchParams.set('toDate', new Date(timestamp).toISOString());

  try {
    const data = await moralisJson<{ usdPrice?: number; usd_price?: number }>(url.toString());
    const price = parseNumber(data.usdPrice ?? data.usd_price);
    priceCache.set(cacheKey, price, ACTIVITY_PRICE_CACHE_TTL_MS);
    return price;
  } catch {
    priceCache.set(cacheKey, 0, 10 * 60_000);
    return 0;
  }
}

async function alchemyRpc<T>(network: string, method: string, params: unknown[]) {
  const apiKey = getAlchemyKey();
  if (!apiKey) throw new Error('Alchemy API key is missing.');

  const payload = await fetchJson<RpcResponse<T>>(`https://${network}.g.alchemy.com/v2/${apiKey}`, {}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `atlaix-${method}`,
      method,
      params
    })
  });

  if (payload.error) throw new Error(payload.error.message || `Alchemy ${method} failed.`);
  return payload.result as T;
}

function tokenFromUnknown(value: unknown): WalletActivityToken | undefined {
  const row = asRecord(value);
  const symbol = firstString(row.symbol, row.token_symbol, row.tokenSymbol, row.asset, row.name);
  const address = firstString(row.address, row.token_address, row.tokenAddress, row.contract_address, row.contractAddress);
  const amount = firstString(row.amount, row.value_formatted, row.valueFormatted, row.quantity);
  const usdValue = parseNumber(row.usdAmount ?? row.usd_amount ?? row.usdValue ?? row.usd_value);
  const logo = firstString(row.logo, row.thumbnail);
  const name = firstString(row.name, row.token_name, row.tokenName);
  if (!symbol && !address && !amount) return undefined;
  return {
    address: address || undefined,
    symbol: symbol || 'TOKEN',
    name: name || undefined,
    amount: amount || undefined,
    usdValue: usdValue || undefined,
    logo: logo || undefined
  };
}

function extractHistoryTokens(row: MoralisHistoryRow) {
  const transfers = [
    ...asArray(row.erc20_transfers),
    ...asArray(row.erc20Transfers),
    ...asArray(row.native_transfers),
    ...asArray(row.nativeTransfers)
  ];
  return transfers.map(tokenFromUnknown).filter((token): token is WalletActivityToken => Boolean(token));
}

function historyKind(row: MoralisHistoryRow): WalletActivityKind {
  const category = firstString(row.category, row.transaction_category, row.type).toLowerCase();
  const summary = firstString(row.summary).toLowerCase();
  if (category.includes('approval') || summary.includes('approved')) return 'approval';
  if (category.includes('swap') || summary.includes('swap')) return 'swap';
  if (category.includes('receive') || summary.includes('received')) return 'receive';
  if (category.includes('send') || summary.includes('sent') || summary.includes('transfer')) return 'send';
  if (category.includes('contract')) return 'contract';
  return 'unknown';
}

function normalizeMoralisHistory(row: MoralisHistoryRow, chain: EvmWalletChain): WalletActivityItem | null {
  const hash = firstString(row.hash, row.transaction_hash, row.transactionHash);
  const timestamp = parseTimestamp(row.block_timestamp ?? row.blockTimestamp ?? row.timestamp);
  const blockNumber = activityBlockNumber(row.block_number, row.blockNumber, row.block);
  if (!hash || !timestamp) return null;

  const kind = historyKind(row);
  const tokens = extractHistoryTokens(row);
  const summary = firstString(row.summary, row.description) || `${kind === 'unknown' ? 'Wallet activity' : kind} transaction ${shortHash(hash)}`;
  const usdValue = Math.max(...tokens.map((token) => token.usdValue || 0), parseNumber(row.value_usd ?? row.valueUsd ?? row.totalValueUsd));

  return {
    id: `${chain}:${hash}:history`,
    hash,
    chain,
    kind,
    timestamp,
    title: kind === 'approval' ? 'Approved token access'
      : kind === 'swap' ? 'Swapped tokens'
        : kind === 'receive' ? `Received ${tokenLabel(tokens[0])}`
          : kind === 'send' ? `Sent ${tokenLabel(tokens[0])}`
            : 'Contract interaction',
    summary,
    tokens,
    usdValue: usdValue || undefined,
    protocol: firstString(row.protocol_name, row.protocolName, row.method_label, row.methodLabel) || undefined,
    counterparty: firstString(row.to_address, row.toAddress, row.from_address, row.fromAddress) || undefined,
    blockNumber: blockNumber || undefined,
    explorerUrl: explorerUrl(chain, hash),
    confidence: kind === 'unknown' ? 'low' : 'high',
    source: 'moralis_history'
  };
}

function normalizeSwapToken(row: MoralisSwapRow, keys: string[]) {
  for (const key of keys) {
    const token = tokenFromUnknown(row[key]);
    if (token) return token;
  }
  return undefined;
}

function normalizeMoralisSwap(row: MoralisSwapRow, chain: EvmWalletChain): WalletActivityItem | null {
  const hash = firstString(row.transactionHash, row.transaction_hash, row.hash);
  const timestamp = parseTimestamp(row.blockTimestamp ?? row.block_timestamp ?? row.timestamp);
  const blockNumber = activityBlockNumber(row.blockNumber, row.block_number, row.block);
  if (!hash || !timestamp) return null;

  const tokenIn = normalizeSwapToken(row, ['sold', 'tokenIn', 'fromToken', 'baseToken']);
  const tokenOut = normalizeSwapToken(row, ['bought', 'tokenOut', 'toToken', 'quoteToken']);
  const tokens = [tokenIn, tokenOut].filter((token): token is WalletActivityToken => Boolean(token));
  const usdValue = parseNumber(row.totalValueUsd ?? row.total_value_usd ?? row.usdAmount ?? row.usd_amount);
  const outSymbol = tokenLabel(tokenOut);
  const inSymbol = tokenLabel(tokenIn);
  const stableIn = tokenIn ? STABLE_SYMBOLS.has(tokenIn.symbol.toUpperCase()) : false;
  const stableOut = tokenOut ? STABLE_SYMBOLS.has(tokenOut.symbol.toUpperCase()) : false;
  const kind: WalletActivityKind = stableIn && !stableOut ? 'buy' : stableOut && !stableIn ? 'sell' : 'swap';

  return {
    id: `${chain}:${hash}:swap`,
    hash,
    chain,
    kind,
    timestamp,
    title: kind === 'buy' ? `Bought ${outSymbol}` : kind === 'sell' ? `Sold ${inSymbol}` : `Swapped ${inSymbol} to ${outSymbol}`,
    summary: `${tokenIn?.amount || ''} ${inSymbol} to ${tokenOut?.amount || ''} ${outSymbol}`.trim(),
    tokenIn,
    tokenOut,
    tokens,
    usdValue: usdValue || tokenIn?.usdValue || tokenOut?.usdValue,
    protocol: firstString(row.exchangeName, row.exchange_name, row.protocol, row.market) || undefined,
    blockNumber: blockNumber || undefined,
    explorerUrl: explorerUrl(chain, hash),
    confidence: 'high',
    source: 'moralis_swaps'
  };
}

function alchemyTransferToken(transfer: AlchemyTransfer, chain: EvmWalletChain): WalletActivityToken {
  const address = transfer.rawContract?.address || '';
  const symbol = transfer.asset || (NATIVE_ADDRESSES.has(address.toLowerCase()) ? evmChainMap[chain].nativeSymbol : 'TOKEN');
  return {
    address: address || undefined,
    symbol,
    amount: transfer.value !== undefined ? String(transfer.value) : undefined
  };
}

function normalizeAlchemyTransfer(transfer: AlchemyTransfer, chain: EvmWalletChain, walletAddress: string): WalletActivityItem | null {
  const hash = transfer.hash || '';
  const timestamp = parseTimestamp(transfer.metadata?.blockTimestamp);
  const blockNumber = activityBlockNumber(transfer.blockNum);
  if (!hash || !timestamp) return null;
  const isIncoming = String(transfer.to || '').toLowerCase() === walletAddress.toLowerCase();
  const kind: WalletActivityKind = isIncoming ? 'receive' : 'send';
  const token = alchemyTransferToken(transfer, chain);

  return {
    id: `${chain}:${hash}:${kind}:${token.address || token.symbol}`,
    hash,
    chain,
    kind,
    timestamp,
    title: `${kind === 'receive' ? 'Received' : 'Sent'} ${token.symbol}`,
    summary: `${token.amount || 'Unknown amount'} ${token.symbol}`,
    tokens: [token],
    counterparty: isIncoming ? transfer.from : transfer.to,
    blockNumber: blockNumber || undefined,
    explorerUrl: explorerUrl(chain, hash),
    confidence: 'medium',
    source: 'alchemy_transfers'
  };
}

async function fetchMoralisHistory(address: string, chain: EvmWalletChain, limit: number) {
  if (!getMoralisKey()) return [];
  const rows: MoralisHistoryRow[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PROVIDER_PAGES && rows.length < limit; page += 1) {
    const url = new URL(`${MORALIS_EVM_BASE_URL}/wallets/${address}/history`);
    url.searchParams.set('chain', evmChainMap[chain].moralis);
    url.searchParams.set('order', 'DESC');
    url.searchParams.set('limit', String(Math.min(PROVIDER_PAGE_SIZE, limit - rows.length)));
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = await moralisJson<{ result?: MoralisHistoryRow[]; cursor?: string } | MoralisHistoryRow[]>(url.toString());
    const pageRows = Array.isArray(data) ? data : data.result || [];
    rows.push(...pageRows);
    cursor = Array.isArray(data) ? '' : firstString(data.cursor);
    if (!cursor || !pageRows.length) break;
  }
  return rows.slice(0, limit).map((row) => normalizeMoralisHistory(row, chain)).filter((item): item is WalletActivityItem => Boolean(item));
}

async function fetchMoralisSwaps(address: string, chain: EvmWalletChain, limit: number) {
  if (!getMoralisKey()) return [];
  const rows: MoralisSwapRow[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PROVIDER_PAGES && rows.length < limit; page += 1) {
    const url = new URL(`${MORALIS_EVM_BASE_URL}/wallets/${address}/swaps`);
    url.searchParams.set('chain', evmChainMap[chain].moralis);
    url.searchParams.set('order', 'DESC');
    url.searchParams.set('limit', String(Math.min(PROVIDER_PAGE_SIZE, limit - rows.length)));
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = await moralisJson<{ result?: MoralisSwapRow[]; cursor?: string } | MoralisSwapRow[]>(url.toString());
    const pageRows = Array.isArray(data) ? data : data.result || [];
    rows.push(...pageRows);
    cursor = Array.isArray(data) ? '' : firstString(data.cursor);
    if (!cursor || !pageRows.length) break;
  }
  return rows.slice(0, limit).map((row) => normalizeMoralisSwap(row, chain)).filter((item): item is WalletActivityItem => Boolean(item));
}

function normalizeMoralisSolanaSwap(row: MoralisSwapRow): WalletActivityItem | null {
  const hash = firstString(row.transactionHash, row.transaction_hash, row.hash);
  const timestamp = parseTimestamp(row.blockTimestamp ?? row.block_timestamp ?? row.timestamp);
  const blockNumber = activityBlockNumber(row.slot, row.blockNumber, row.block_number, row.block);
  if (!hash || !timestamp) return null;

  const tokenIn = normalizeSwapToken(row, ['sold', 'tokenIn', 'fromToken', 'baseToken']);
  const tokenOut = normalizeSwapToken(row, ['bought', 'tokenOut', 'toToken', 'quoteToken']);
  const tokens = [tokenIn, tokenOut].filter((token): token is WalletActivityToken => Boolean(token));
  const usdValue = parseNumber(row.totalValueUsd ?? row.total_value_usd ?? row.usdAmount ?? row.usd_amount);
  const outSymbol = tokenLabel(tokenOut);
  const inSymbol = tokenLabel(tokenIn);
  const type = firstString(row.transactionType, row.transaction_type).toLowerCase();
  const kind: WalletActivityKind = type === 'buy' ? 'buy' : type === 'sell' ? 'sell' : 'swap';

  return {
    id: `Solana:${hash}:swap`,
    hash,
    chain: 'Solana',
    kind,
    timestamp,
    title: kind === 'buy' ? `Bought ${outSymbol}` : kind === 'sell' ? `Sold ${inSymbol}` : `Swapped ${inSymbol} to ${outSymbol}`,
    summary: `${tokenIn?.amount || ''} ${inSymbol} to ${tokenOut?.amount || ''} ${outSymbol}`.trim(),
    tokenIn,
    tokenOut,
    tokens,
    usdValue: usdValue || tokenIn?.usdValue || tokenOut?.usdValue,
    protocol: firstString(row.exchangeName, row.exchange_name, row.protocol, row.market) || undefined,
    blockNumber: blockNumber || undefined,
    explorerUrl: solanaExplorerUrl(hash),
    confidence: 'high',
    source: 'moralis_swaps'
  };
}

async function fetchMoralisSolanaSwaps(address: string, limit: number) {
  if (!getMoralisKey()) return [];
  const rows: MoralisSwapRow[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_PROVIDER_PAGES && rows.length < limit; page += 1) {
    const url = new URL(`${MORALIS_SOLANA_BASE_URL}/account/mainnet/${address}/swaps`);
    url.searchParams.set('limit', String(Math.min(PROVIDER_PAGE_SIZE, limit - rows.length)));
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = await moralisJson<{ result?: MoralisSwapRow[]; cursor?: string } | MoralisSwapRow[]>(url.toString());
    const pageRows = Array.isArray(data) ? data : data.result || [];
    rows.push(...pageRows);
    cursor = Array.isArray(data) ? '' : firstString(data.cursor);
    if (!cursor || !pageRows.length) break;
  }
  return rows.slice(0, limit).map(normalizeMoralisSolanaSwap).filter((item): item is WalletActivityItem => Boolean(item));
}

async function fetchAlchemyTransfers(address: string, chain: EvmWalletChain, limit: number) {
  const network = evmChainMap[chain].alchemy;
  if (!network || !getAlchemyKey()) return [];

  const baseParams = {
    fromBlock: '0x0',
    toBlock: 'latest',
    category: ['external', 'internal', 'erc20'],
    excludeZeroValue: true,
    withMetadata: true,
    maxCount: `0x${Math.min(limit, PROVIDER_PAGE_SIZE).toString(16)}`,
    order: 'desc'
  };

  const [incoming, outgoing] = await Promise.all([
    alchemyRpc<{ transfers?: AlchemyTransfer[] }>(network, 'alchemy_getAssetTransfers', [{ ...baseParams, toAddress: address }]).catch(() => ({ transfers: [] })),
    alchemyRpc<{ transfers?: AlchemyTransfer[] }>(network, 'alchemy_getAssetTransfers', [{ ...baseParams, fromAddress: address }]).catch(() => ({ transfers: [] }))
  ]);

  return [...(incoming.transfers || []), ...(outgoing.transfers || [])]
    .map((transfer) => normalizeAlchemyTransfer(transfer, chain, address))
    .filter((item): item is WalletActivityItem => Boolean(item));
}

function dedupeActivities(activities: WalletActivityItem[]) {
  const byKey = new Map<string, WalletActivityItem>();
  const sourceRank: Record<WalletActivitySource, number> = {
    moralis_swaps: 3,
    moralis_history: 2,
    alchemy_transfers: 1
  };

  activities.forEach((activity) => {
    const key = `${activity.chain}:${activity.hash}:${activity.kind}`;
    const existing = byKey.get(key);
    if (!existing || sourceRank[activity.source] > sourceRank[existing.source]) {
      byKey.set(key, activity);
    }
  });

  return [...byKey.values()].sort((left, right) => right.timestamp - left.timestamp);
}

function setStableTokenValue(token: WalletActivityToken) {
  if (token.usdValue || !STABLE_SYMBOLS.has(token.symbol.toUpperCase())) return;
  const amount = parseTokenAmount(token.amount);
  if (amount > 0) token.usdValue = amount;
}

function inferActivityValue(activity: WalletActivityItem) {
  if (activity.usdValue) return;
  activity.tokens.forEach(setStableTokenValue);
  const tokenValue = Math.max(...activity.tokens.map((token) => token.usdValue || 0), 0);
  if (tokenValue > 0) activity.usdValue = tokenValue;
}

async function enrichTokenValue(token: WalletActivityToken, activity: WalletActivityItem) {
  if (token.usdValue) return;
  setStableTokenValue(token);
  if (token.usdValue) return;

  const amount = parseTokenAmount(token.amount);
  const address = tokenPriceAddress(token, activity.chain);
  if (!amount || !address) return;

  let price = await fetchMoralisActivityPrice(address, activity.chain, activity.blockNumber, activity.timestamp);
  const isRecent = activity.timestamp > Date.now() - 24 * 60 * 60_000;
  if (!price && isRecent) price = await fetchMoralisActivityPrice(address, activity.chain);
  if (price > 0) token.usdValue = amount * price;
}

async function enrichActivityValues(activities: WalletActivityItem[]) {
  activities.forEach(inferActivityValue);
  const candidates = activities
    .filter((activity) => !activity.usdValue && activity.tokens.some((token) => parseTokenAmount(token.amount) > 0))
    .slice(0, ACTIVITY_PRICE_ENRICHMENT_LIMIT);

  for (const activity of candidates) {
    for (const token of activity.tokens) {
      await enrichTokenValue(token, activity);
      inferActivityValue(activity);
      if (activity.usdValue) break;
    }
  }

  return activities;
}

function matchesKind(activity: WalletActivityItem, kind: string) {
  if (!kind || kind === 'all') return true;
  if (kind === 'large') return (activity.usdValue || 0) >= 1_000;
  return activity.kind === kind;
}

function matchesPeriod(activity: WalletActivityItem, period: string) {
  if (period === '>1M') return activity.timestamp > 0 && activity.timestamp < Date.now() - 30 * 86_400_000;
  const start = periodStart(period);
  return !start || activity.timestamp >= start;
}

function updateTradedToken(map: Map<string, WalletTradedToken>, token: WalletActivityToken, activity: WalletActivityItem) {
  const key = `${activity.chain}:${(token.address || token.symbol).toLowerCase()}`;
  const existing = map.get(key) || {
    address: token.address,
    symbol: token.symbol,
    logo: token.logo,
    chain: activity.chain,
    buys: 0,
    sells: 0,
    swaps: 0,
    receives: 0,
    sends: 0,
    totalUsdVolume: 0,
    lastActivityAt: 0
  };

  if (activity.kind === 'buy') existing.buys += 1;
  if (activity.kind === 'sell') existing.sells += 1;
  if (activity.kind === 'swap') existing.swaps += 1;
  if (activity.kind === 'receive') existing.receives += 1;
  if (activity.kind === 'send') existing.sends += 1;
  existing.totalUsdVolume += token.usdValue || activity.usdValue || 0;
  existing.lastActivityAt = Math.max(existing.lastActivityAt, activity.timestamp);
  map.set(key, existing);
}

function buildTradedTokens(activities: WalletActivityItem[]) {
  const tokens = new Map<string, WalletTradedToken>();
  activities.forEach((activity) => {
    const activityTokens = activity.kind === 'buy' && activity.tokenOut ? [activity.tokenOut]
      : activity.kind === 'sell' && activity.tokenIn ? [activity.tokenIn]
        : activity.tokens;
    activityTokens.forEach((token) => updateTradedToken(tokens, token, activity));
  });
  return [...tokens.values()]
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt || right.totalUsdVolume - left.totalUsdVolume)
    .slice(0, 12);
}

function buildSummary(activities: WalletActivityItem[], tradedTokens: WalletTradedToken[]): WalletActivitySummary {
  const largest = activities.reduce<WalletActivityItem | null>((best, item) => (item.usdValue || 0) > (best?.usdValue || 0) ? item : best, null);
  const netFlowUsd = activities.reduce((total, item) => {
    const value = item.usdValue || 0;
    if (item.kind === 'receive' || item.kind === 'buy') return total + value;
    if (item.kind === 'send' || item.kind === 'sell') return total - value;
    return total;
  }, 0);

  return {
    lastActiveAt: activities[0]?.timestamp || 0,
    recentBuys: activities.filter((item) => item.kind === 'buy').length,
    recentSells: activities.filter((item) => item.kind === 'sell').length,
    largestMoveUsd: largest?.usdValue || 0,
    largestMoveLabel: largest ? largest.title : 'No activity',
    mostTradedToken: tradedTokens[0]?.symbol || 'No token yet',
    netFlowUsd
  };
}

function providerMissing(message: string): WalletActivityResponse {
  const tradedTokens: WalletTradedToken[] = [];
  return {
    activities: [],
    summary: buildSummary([], tradedTokens),
    tradedTokens,
    providerStatus: 'provider_missing',
    message,
    generatedAt: new Date().toISOString()
  };
}

async function loadEvmChainActivity(address: string, chain: EvmWalletChain, limit: number) {
  const [history, swaps, transfers] = await Promise.allSettled([
    fetchMoralisHistory(address, chain, limit),
    fetchMoralisSwaps(address, chain, limit),
    fetchAlchemyTransfers(address, chain, limit)
  ]);

  return [history, swaps, transfers].flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

async function loadActivity(address: string, chain: WalletChain, options: ActivityOptions): Promise<WalletActivityResponse> {
  if (chain === 'Solana') {
    if (!getMoralisKey()) return providerMissing('Add MORALIS_API_KEY to .env to load Solana wallet swaps.');
    const periodActivities = dedupeActivities(await fetchMoralisSolanaSwaps(address, options.limit))
      .filter((activity) => matchesPeriod(activity, options.period))
      .slice(0, options.limit);
    const activities = (await enrichActivityValues(periodActivities))
      .filter((activity) => matchesKind(activity, options.kind))
      .slice(0, options.limit);
    const tradedTokens = buildTradedTokens(activities);
    return {
      activities,
      summary: buildSummary(activities, tradedTokens),
      tradedTokens,
      providerStatus: activities.length ? 'ready' : 'partial',
      message: activities.length ? undefined : 'No Solana swaps returned for this wallet and time period.',
      generatedAt: new Date().toISOString()
    };
  }

  if (!getMoralisKey() && !getAlchemyKey()) {
    return providerMissing('Add MORALIS_API_KEY or ALCHEMY_API_KEY to .env to load wallet activity.');
  }

  const chains = chain === 'All Chains' ? evmAggregateChains : [chain as EvmWalletChain];
  const perChainLimit = chain === 'All Chains' ? Math.max(12, Math.ceil(options.limit / chains.length)) : options.limit;
  const results = await Promise.allSettled(chains.map((item) => loadEvmChainActivity(address, item, perChainLimit)));
  const periodActivities = dedupeActivities(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))
    .filter((activity) => matchesPeriod(activity, options.period))
    .slice(0, options.limit);
  const activities = (await enrichActivityValues(periodActivities))
    .filter((activity) => matchesKind(activity, options.kind))
    .slice(0, options.limit);
  const tradedTokens = buildTradedTokens(activities);

  return {
    activities,
    summary: buildSummary(activities, tradedTokens),
    tradedTokens,
    providerStatus: activities.length ? 'ready' : 'partial',
    message: activities.length ? undefined : 'No wallet activity returned for this chain and time period.',
    generatedAt: new Date().toISOString()
  };
}

export class WalletActivityService {
  async getActivity(address: string, chain: WalletChain, options: ActivityOptions) {
    const safeOptions = {
      ...options,
      limit: Math.max(10, Math.min(options.limit || WALLET_ACTIVITY_LIMIT, WALLET_ACTIVITY_LIMIT))
    };
    const key = `${chain}:${address.toLowerCase()}:${safeOptions.period}:${safeOptions.kind}:${safeOptions.limit}`;
    const cached = cache.get(key);
    if (cached) return cached.value as WalletActivityResponse;

    const existing = pending.get(key);
    if (existing) return existing;

    const request = loadActivity(address, chain, safeOptions)
      .then((activity) => {
        cache.set(key, activity, WALLET_ACTIVITY_CACHE_TTL_MS, activity.generatedAt);
        return activity;
      })
      .finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }
}
