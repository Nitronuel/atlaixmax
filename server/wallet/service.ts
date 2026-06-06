import { readEnv } from '../env';
import { TtlCache } from '../insightx/cache';

type WalletChain = 'All Chains' | 'Ethereum' | 'Solana' | 'Base' | 'BSC' | 'Arbitrum' | 'Optimism' | 'Polygon' | 'Avalanche';
type EvmWalletChain = Exclude<WalletChain, 'All Chains' | 'Solana'>;

type WalletAsset = {
  symbol: string;
  address: string;
  balance: string;
  value: string;
  price: string;
  currentPrice: number;
  rawValue: number;
  logo?: string;
  chain?: WalletChain;
  chainLogo?: string;
  pnl?: string;
  pnlPercent?: number;
  buyTime?: number;
};

export type WalletPortfolioResponse = {
  netWorth: string;
  assets: WalletAsset[];
  providerStatus: 'ready' | 'provider_missing' | 'error';
  message?: string;
  generatedAt: string;
};

type MoralisToken = {
  name?: string;
  symbol?: string;
  decimals?: number | string;
  balance?: string;
  balance_formatted?: string;
  usd_price?: string | number;
  usd_value?: number | string;
  native_token?: boolean;
  token_address?: string;
  logo?: string;
  thumbnail?: string;
  possible_spam?: boolean;
};

type MoralisEvmResponse = {
  result?: MoralisToken[];
  cursor?: string;
};

type MoralisSolanaToken = {
  mint?: string;
  token_address?: string;
  name?: string;
  symbol?: string;
  amount?: string;
  amountRaw?: string;
  balance?: string;
  decimals?: number | string;
  logo?: string;
  thumbnail?: string;
  possibleSpam?: boolean;
  possible_spam?: boolean;
  usdPrice?: number | string;
  usd_price?: number | string;
  usdValue?: number | string;
  usd_value?: number | string;
};

type AlchemyTokenBalance = {
  contractAddress: string;
  tokenBalance: string;
};

type AlchemyTokenMetadata = {
  symbol?: string;
  decimals?: number;
  logo?: string;
};

type RpcResponse<T> = {
  result?: T;
  error?: {
    message?: string;
  };
};

const WALLET_CACHE_TTL_MS = 60_000;
const MAX_MORALIS_PAGES = 5;
const ALCHEMY_METADATA_BATCH_SIZE = 20;
const SOLANA_NATIVE_MINT = 'So11111111111111111111111111111111111111112';
const MORALIS_EVM_BASE_URL = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_SOLANA_BASE_URL = 'https://solana-gateway.moralis.io';
const SOLANA_LOGO = 'https://cryptologos.cc/logos/solana-sol-logo.png';
const cache = new TtlCache();
const pending = new Map<string, Promise<WalletPortfolioResponse>>();

const evmChainMap: Record<EvmWalletChain, { moralis: string; alchemy?: string; logo: string; nativeSymbol: string; nativeName: string; wrappedNative?: string }> = {
  Ethereum: {
    moralis: 'eth',
    alchemy: 'eth-mainnet',
    logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.png',
    nativeSymbol: 'ETH',
    nativeName: 'Ethereum',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  },
  Base: {
    moralis: 'base',
    alchemy: 'base-mainnet',
    logo: 'https://cryptologos.cc/logos/base-base-logo.png',
    nativeSymbol: 'ETH',
    nativeName: 'Ethereum (Base)',
    wrappedNative: '0x4200000000000000000000000000000000000006'
  },
  BSC: {
    moralis: 'bsc',
    logo: 'https://cryptologos.cc/logos/bnb-bnb-logo.png',
    nativeSymbol: 'BNB',
    nativeName: 'BNB Smart Chain',
    wrappedNative: '0xbb4CdB9CBd36B01dCbaEBF2De08d9173bc095c'
  },
  Arbitrum: {
    moralis: 'arbitrum',
    alchemy: 'arb-mainnet',
    logo: 'https://cryptologos.cc/logos/arbitrum-arb-logo.png',
    nativeSymbol: 'ETH',
    nativeName: 'Ethereum (Arbitrum)',
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'
  },
  Optimism: {
    moralis: 'optimism',
    alchemy: 'opt-mainnet',
    logo: 'https://cryptologos.cc/logos/optimism-ethereum-op-logo.png',
    nativeSymbol: 'ETH',
    nativeName: 'Ethereum (Optimism)',
    wrappedNative: '0x4200000000000000000000000000000000000006'
  },
  Polygon: {
    moralis: 'polygon',
    alchemy: 'polygon-mainnet',
    logo: 'https://cryptologos.cc/logos/polygon-matic-logo.png',
    nativeSymbol: 'MATIC',
    nativeName: 'Polygon',
    wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'
  },
  Avalanche: {
    moralis: 'avalanche',
    logo: 'https://cryptologos.cc/logos/avalanche-avax-logo.png',
    nativeSymbol: 'AVAX',
    nativeName: 'Avalanche',
    wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
  }
};

const evmAggregateChains: EvmWalletChain[] = ['Ethereum', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'];

function getMoralisKey() {
  return readEnv('MORALIS_API_KEY', 'VITE_MORALIS_KEY', 'VITE_MORALIS_API_KEY');
}

function getAlchemyKey() {
  return readEnv('ALCHEMY_API_KEY', 'VITE_ALCHEMY_KEY', 'VITE_ALCHEMY_API_KEY');
}

function getHeliusKey() {
  return readEnv('HELIUS_API_KEY', 'VITE_HELIUS_KEY', 'VITE_HELIUS_API_KEY');
}

function formatUsd(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function formatTokenAmount(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: value >= 1 ? 4 : 8 });
}

function parseNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseRawTokenBalance(rawValue: string, decimals: number) {
  if (!rawValue || rawValue === '0x0') return 0;

  try {
    const raw = rawValue.startsWith('0x') ? BigInt(rawValue) : BigInt(rawValue);
    const scale = 10 ** Math.min(decimals, 18);
    const divisor = BigInt(scale);
    const whole = raw / divisor;
    const fraction = raw % divisor;
    return Number(whole) + Number(fraction) / scale;
  } catch {
    return 0;
  }
}

async function fetchJson<T>(url: string, headers: Record<string, string>, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...headers, ...(init?.headers || {}) } });
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function moralisJson<T>(url: string) {
  const apiKey = getMoralisKey();
  if (!apiKey) throw new Error('Moralis API key is missing.');
  return fetchJson<T>(url, { 'X-API-Key': apiKey });
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

async function heliusRpc<T>(method: string, params: unknown[]) {
  const apiKey = getHeliusKey();
  if (!apiKey) throw new Error('Helius API key is missing.');

  const payload = await fetchJson<RpcResponse<T>>(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `atlaix-${method}`,
      method,
      params
    })
  });

  if (payload.error) throw new Error(payload.error.message || `Helius ${method} failed.`);
  return payload.result as T;
}

function providerMissing(message = 'Add wallet provider API keys to .env to load holdings.') {
  return {
    netWorth: '$0.00',
    assets: [],
    providerStatus: 'provider_missing',
    message,
    generatedAt: new Date().toISOString()
  } satisfies WalletPortfolioResponse;
}

function portfolioFromAssets(assets: WalletAsset[], message?: string): WalletPortfolioResponse {
  const netWorth = assets.reduce((total, asset) => total + asset.rawValue, 0);
  return {
    netWorth: formatUsd(netWorth),
    assets: assets.sort((a, b) => b.rawValue - a.rawValue),
    providerStatus: 'ready',
    message,
    generatedAt: new Date().toISOString()
  };
}

async function fetchMoralisPrice(address: string, chain: WalletChain) {
  if (!getMoralisKey()) return 0;

  const isSolana = chain === 'Solana';
  const url = isSolana
    ? `${MORALIS_SOLANA_BASE_URL}/token/mainnet/${address}/price`
    : `${MORALIS_EVM_BASE_URL}/erc20/${address}/price?chain=${evmChainMap[chain as EvmWalletChain].moralis}`;

  try {
    const data = await moralisJson<{ usdPrice?: number; usd_price?: number }>(url);
    return parseNumber(data.usdPrice ?? data.usd_price);
  } catch {
    return 0;
  }
}

async function fetchMoralisEvmNativeBalance(address: string, chain: EvmWalletChain) {
  const chainConfig = evmChainMap[chain];
  const data = await moralisJson<{ balance?: string }>(`${MORALIS_EVM_BASE_URL}/${address}/balance?chain=${chainConfig.moralis}`);
  const balance = parseRawTokenBalance(data.balance || '0', 18);
  if (balance <= 0) return null;

  const price = chainConfig.wrappedNative ? await fetchMoralisPrice(chainConfig.wrappedNative, chain) : 0;
  const value = balance * price;

  return {
    symbol: chainConfig.nativeSymbol,
    address: `${chain.toLowerCase()}:native`,
    balance: `${formatTokenAmount(balance)} ${chainConfig.nativeSymbol}`,
    value: value > 0 ? formatUsd(value) : 'N/A',
    price: price > 0 ? formatUsd(price) : 'N/A',
    currentPrice: price,
    rawValue: value,
    logo: chainConfig.logo,
    chain,
    chainLogo: chainConfig.logo,
    pnl: value > 1 ? 'Loading...' : 'N/A'
  } satisfies WalletAsset;
}

async function fetchMoralisEvmTokens(address: string, chain: EvmWalletChain) {
  const chainConfig = evmChainMap[chain];
  const tokens: MoralisToken[] = [];
  let cursor = '';

  for (let page = 0; page < MAX_MORALIS_PAGES; page += 1) {
    const url = new URL(`${MORALIS_EVM_BASE_URL}/${address}/erc20`);
    url.searchParams.set('chain', chainConfig.moralis);
    url.searchParams.set('exclude_spam', 'true');
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = await moralisJson<MoralisEvmResponse | MoralisToken[]>(url.toString());
    const rows = Array.isArray(data) ? data : data.result || [];
    tokens.push(...rows);
    cursor = Array.isArray(data) ? '' : data.cursor || '';
    if (!cursor) break;
  }

  return tokens
    .filter((token) => !token.possible_spam)
    .map((token) => {
      const symbol = token.symbol || token.name || 'TOKEN';
      const decimals = parseNumber(token.decimals, 18);
      const balance = token.balance_formatted !== undefined
        ? parseNumber(token.balance_formatted)
        : parseRawTokenBalance(token.balance || '0', decimals);
      const price = parseNumber(token.usd_price);
      const value = parseNumber(token.usd_value, balance * price);

      return {
        symbol,
        address: token.token_address || '',
        balance: `${formatTokenAmount(balance)} ${symbol}`,
        value: value > 0 ? formatUsd(value) : 'N/A',
        price: price > 0 ? formatUsd(price) : 'N/A',
        currentPrice: price,
        rawValue: value,
        logo: token.logo || token.thumbnail,
        chain,
        chainLogo: chainConfig.logo,
        pnl: value > 1 ? 'Loading...' : 'N/A'
      } satisfies WalletAsset;
    })
    .filter((asset) => asset.address);
}

async function fetchMoralisEvmChain(address: string, chain: EvmWalletChain) {
  if (!getMoralisKey()) throw new Error('Moralis API key is missing.');

  const [nativeResult, tokenResult] = await Promise.allSettled([
    fetchMoralisEvmNativeBalance(address, chain),
    fetchMoralisEvmTokens(address, chain)
  ]);

  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
  const tokens = tokenResult.status === 'fulfilled' ? tokenResult.value : [];
  const assets = native ? [native, ...tokens] : tokens;
  return assets;
}

async function fetchAlchemyEvmChain(address: string, chain: EvmWalletChain) {
  const network = evmChainMap[chain].alchemy;
  if (!getAlchemyKey() || !network) return [];

  const nativeBalanceHex = await alchemyRpc<string>(network, 'eth_getBalance', [address, 'latest']).catch(() => '0x0');
  const balancesResponse = await alchemyRpc<{ tokenBalances?: AlchemyTokenBalance[]; pageKey?: string }>(
    network,
    'alchemy_getTokenBalances',
    [address, { type: ['erc20'] }]
  );

  const balances = (balancesResponse.tokenBalances || [])
    .filter((token) => token.tokenBalance && token.tokenBalance !== '0x0')
    .slice(0, 100);

  const metadata = new Map<string, AlchemyTokenMetadata>();
  for (let index = 0; index < balances.length; index += ALCHEMY_METADATA_BATCH_SIZE) {
    const chunk = balances.slice(index, index + ALCHEMY_METADATA_BATCH_SIZE);
    const rows = await Promise.all(chunk.map(async (token) => {
      try {
        const result = await alchemyRpc<AlchemyTokenMetadata>(network, 'alchemy_getTokenMetadata', [token.contractAddress]);
        return [token.contractAddress.toLowerCase(), result || {}] as const;
      } catch {
        return [token.contractAddress.toLowerCase(), {}] as const;
      }
    }));
    rows.forEach(([addressKey, meta]) => metadata.set(addressKey, meta));
  }

  const chainConfig = evmChainMap[chain];
  const nativeBalance = parseRawTokenBalance(nativeBalanceHex, 18);
  const nativeAsset: WalletAsset[] = nativeBalance > 0 ? [{
    symbol: chainConfig.nativeSymbol,
    address: `${chain.toLowerCase()}:native`,
    balance: `${formatTokenAmount(nativeBalance)} ${chainConfig.nativeSymbol}`,
    value: 'N/A',
    price: 'N/A',
    currentPrice: 0,
    rawValue: 0,
    logo: chainConfig.logo,
    chain,
    chainLogo: chainConfig.logo,
    pnl: 'N/A'
  }] : [];

  const tokenAssets = balances.map((token) => {
    const meta = metadata.get(token.contractAddress.toLowerCase()) || {};
    const symbol = meta.symbol || 'TOKEN';
    const decimals = meta.decimals ?? 18;
    const balance = parseRawTokenBalance(token.tokenBalance, decimals);

    return {
      symbol,
      address: token.contractAddress,
      balance: `${formatTokenAmount(balance)} ${symbol}`,
      value: 'N/A',
      price: 'N/A',
      currentPrice: 0,
      rawValue: 0,
      logo: meta.logo,
      chain,
      chainLogo: chainConfig.logo,
      pnl: 'N/A'
    } satisfies WalletAsset;
  });

  return [...nativeAsset, ...tokenAssets];
}

async function fetchEvmChain(address: string, chain: EvmWalletChain) {
  try {
    const moralisAssets = await fetchMoralisEvmChain(address, chain);
    if (moralisAssets.length || getMoralisKey()) return moralisAssets;
  } catch (error) {
    console.warn(`[WalletPortfolio] Moralis ${chain} lookup failed.`, error);
  }

  return fetchAlchemyEvmChain(address, chain);
}

async function fetchHeliusNativeSol(address: string) {
  if (!getHeliusKey()) return null;

  const result = await heliusRpc<{ value?: number }>('getBalance', [address, { commitment: 'confirmed' }]);
  const balance = parseNumber(result?.value) / 1e9;
  if (balance <= 0) return null;

  const price = await fetchMoralisPrice(SOLANA_NATIVE_MINT, 'Solana');
  const value = balance * price;
  return {
    symbol: 'SOL',
    address: SOLANA_NATIVE_MINT,
    balance: `${formatTokenAmount(balance)} SOL`,
    value: value > 0 ? formatUsd(value) : 'N/A',
    price: price > 0 ? formatUsd(price) : 'N/A',
    currentPrice: price,
    rawValue: value,
    logo: SOLANA_LOGO,
    chain: 'Solana',
    chainLogo: SOLANA_LOGO,
    pnl: value > 1 ? 'Loading...' : 'N/A'
  } satisfies WalletAsset;
}

async function fetchMoralisSolanaTokens(address: string) {
  if (!getMoralisKey()) return [];

  const data = await moralisJson<MoralisSolanaToken[] | { result?: MoralisSolanaToken[]; tokens?: MoralisSolanaToken[] }>(
    `${MORALIS_SOLANA_BASE_URL}/account/mainnet/${address}/tokens`
  );
  const tokens = Array.isArray(data) ? data : data.result || data.tokens || [];

  return Promise.all(tokens
    .filter((token) => !(token.possibleSpam || token.possible_spam))
    .slice(0, 50)
    .map(async (token) => {
      const mint = token.mint || token.token_address || '';
      const symbol = token.symbol || token.name || 'TOKEN';
      const decimals = parseNumber(token.decimals, 0);
      const amount = token.amount !== undefined
        ? parseNumber(token.amount)
        : token.balance !== undefined
          ? parseRawTokenBalance(token.balance, decimals)
          : parseRawTokenBalance(token.amountRaw || '0', decimals);
      const price = parseNumber(token.usdPrice ?? token.usd_price) || (mint ? await fetchMoralisPrice(mint, 'Solana') : 0);
      const value = parseNumber(token.usdValue ?? token.usd_value, amount * price);

      return {
        symbol,
        address: mint,
        balance: `${formatTokenAmount(amount)} ${symbol}`,
        value: value > 0 ? formatUsd(value) : 'N/A',
        price: price > 0 ? formatUsd(price) : 'N/A',
        currentPrice: price,
        rawValue: value,
        logo: token.logo || token.thumbnail,
        chain: 'Solana',
        chainLogo: SOLANA_LOGO,
        pnl: value > 1 ? 'Loading...' : 'N/A'
      } satisfies WalletAsset;
    }));
}

async function fetchSolanaPortfolio(address: string) {
  if (!getMoralisKey() && !getHeliusKey()) {
    return providerMissing('Add MORALIS_API_KEY and HELIUS_API_KEY to .env to load Solana wallet holdings.');
  }

  const [nativeResult, tokenResult] = await Promise.allSettled([
    fetchHeliusNativeSol(address),
    fetchMoralisSolanaTokens(address)
  ]);

  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
  let tokens: WalletAsset[] = tokenResult.status === 'fulfilled' ? tokenResult.value : [];

  return portfolioFromAssets(
    [native, ...tokens].filter(Boolean) as WalletAsset[],
    'No visible Solana holdings found.'
  );
}

async function loadPortfolio(address: string, chain: WalletChain): Promise<WalletPortfolioResponse> {
  const isSolanaAddress = !address.startsWith('0x');
  if (isSolanaAddress && (chain === 'All Chains' || chain === 'Solana')) return fetchSolanaPortfolio(address);

  if (chain === 'Solana') return fetchSolanaPortfolio(address);

  if (!getMoralisKey() && !getAlchemyKey()) {
    return providerMissing('Add MORALIS_API_KEY or ALCHEMY_API_KEY to .env to load EVM wallet holdings.');
  }

  if (chain === 'All Chains') {
    const results = await Promise.allSettled(evmAggregateChains.map((item) => fetchEvmChain(address, item)));
    const assets = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (!assets.length) {
      return providerMissing('No EVM balances returned for this wallet.');
    }
    return portfolioFromAssets(assets);
  }

  const assets = await fetchEvmChain(address, chain);
  if (!assets.length && !getMoralisKey()) {
    return providerMissing('No EVM balances returned for this wallet.');
  }

  return portfolioFromAssets(assets);
}

export class WalletPortfolioService {
  async getPortfolio(address: string, chain: WalletChain, period: string) {
    const key = `${chain}:${address.toLowerCase()}:${period}`;
    const cached = cache.get(key);
    if (cached) return cached.value as WalletPortfolioResponse;

    const existing = pending.get(key);
    if (existing) return existing;

    const request = loadPortfolio(address, chain)
      .then((portfolio) => {
        cache.set(key, portfolio, WALLET_CACHE_TTL_MS, portfolio.generatedAt);
        return portfolio;
      })
      .finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }
}
