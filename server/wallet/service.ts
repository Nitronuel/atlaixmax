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
  rawBalance?: number;
  logo?: string;
  chain?: WalletChain;
  chainLogo?: string;
  pnl?: string;
  pnlPercent?: number;
  buyTime?: number;
  avgBuy?: string;
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
const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'USDS']);
const dexScreenerChainMap: Partial<Record<WalletChain, string>> = {
  Ethereum: 'ethereum',
  Solana: 'solana',
  Base: 'base',
  BSC: 'bsc',
  Arbitrum: 'arbitrum',
  Optimism: 'optimism',
  Polygon: 'polygon',
  Avalanche: 'avalanche'
};

function getMoralisKey() {
  return readEnv('MORALIS_API_KEY', 'VITE_MORALIS_KEY', 'VITE_MORALIS_API_KEY');
}

function getAlchemyKey() {
  return readEnv('ALCHEMY_API_KEY', 'VITE_ALCHEMY_KEY', 'VITE_ALCHEMY_API_KEY');
}

function getHeliusKey() {
  return readEnv('HELIUS_API_KEY', 'VITE_HELIUS_KEY', 'VITE_HELIUS_API_KEY');
}

function formatUsd(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits });
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

async function priceMissingAssets(assets: WalletAsset[]) {
  const byChain = new Map<WalletChain, WalletAsset[]>();
  assets
    .filter((asset) => asset.rawBalance && asset.rawBalance > 0 && asset.currentPrice <= 0 && asset.address && !asset.address.includes(':native'))
    .slice(0, 300)
    .forEach((asset) => {
      const chain = asset.chain || 'All Chains';
      byChain.set(chain, [...(byChain.get(chain) || []), asset]);
    });

  for (const [chain, chainAssets] of byChain) {
    const prices = await fetchDexScreenerPrices(chain, chainAssets.map((asset) => asset.address));
    chainAssets.forEach((asset) => {
      const priced = prices.get(asset.address.toLowerCase());
      if (!priced || !asset.rawBalance) return;
      const isStable = STABLE_SYMBOLS.has(asset.symbol.toUpperCase());
      const price = isStable && (priced.price < 0.8 || priced.price > 1.2) ? 1 : priced.price;
      const value = asset.rawBalance * price;
      asset.currentPrice = price;
      asset.price = formatUsd(price, price >= 1 ? 4 : 8);
      asset.rawValue = value;
      asset.value = formatUsd(value);
      if (priced.logo && !asset.logo) asset.logo = priced.logo;
      if (asset.rawValue > 1 && (!asset.pnl || asset.pnl === 'N/A')) asset.pnl = 'Loading...';
    });
  }
}

function nativeCostBasisToken(chain: WalletChain) {
  return chain === 'Solana' ? SOLANA_NATIVE_MINT : evmChainMap[chain as EvmWalletChain]?.wrappedNative || '';
}

async function fetchEvmBlockTimestamp(chain: EvmWalletChain, blockNumberHex: string) {
  const network = evmChainMap[chain].alchemy;
  if (!network || !getAlchemyKey()) return 0;
  try {
    const block = await alchemyRpc<{ timestamp?: string }>(network, 'eth_getBlockByNumber', [blockNumberHex, false]);
    return block?.timestamp ? Number.parseInt(block.timestamp, 16) * 1000 : 0;
  } catch {
    return 0;
  }
}

async function estimateEvmCostBasis(walletAddress: string, asset: WalletAsset) {
  const chain = asset.chain as EvmWalletChain;
  if (!chain || !(chain in evmChainMap)) return { price: 0, timestamp: 0 };

  const isNative = asset.address.includes(':native');
  const tokenAddress = isNative ? nativeCostBasisToken(chain) : asset.address;

  if (getAlchemyKey() && evmChainMap[chain].alchemy) {
    try {
      const params: Record<string, unknown> = {
        fromBlock: '0x0',
        toBlock: 'latest',
        toAddress: walletAddress,
        category: isNative ? ['external', 'internal'] : ['erc20'],
        maxCount: '0x32',
        order: 'desc'
      };
      if (!isNative) params.contractAddresses = [asset.address];
      const response = await alchemyRpc<{ transfers?: Array<{ value?: number | string; blockNum?: string }> }>(
        evmChainMap[chain].alchemy!,
        'alchemy_getAssetTransfers',
        [params]
      );
      const transfers = (response.transfers || []).filter((transfer) => Number(transfer.value) > 0);
      const largest = transfers.sort((left, right) => Number(right.value || 0) - Number(left.value || 0))[0];
      if (largest?.blockNum) {
        const block = BigInt(largest.blockNum).toString();
        const [price, timestamp] = await Promise.all([
          fetchMoralisPrice(tokenAddress, chain, block),
          fetchEvmBlockTimestamp(chain, largest.blockNum)
        ]);
        if (price > 0 || timestamp > 0) return { price, timestamp };
      }
    } catch {
      // Fall through to Moralis transfers.
    }
  }

  if (!getMoralisKey()) return { price: 0, timestamp: 0 };
  try {
    const hexChain = evmChainMap[chain].moralis;
    const url = isNative
      ? new URL(`${MORALIS_EVM_BASE_URL}/${walletAddress}`)
      : new URL(`${MORALIS_EVM_BASE_URL}/${walletAddress}/erc20/transfers`);
    url.searchParams.set('chain', hexChain);
    url.searchParams.set('order', 'DESC');
    url.searchParams.set('limit', '50');
    if (!isNative) url.searchParams.set('contract_addresses[0]', asset.address);
    const data = await moralisJson<{ result?: Array<{ to_address?: string; value?: string; block_number?: string; block_timestamp?: string }> }>(url.toString());
    const incoming = (data.result || [])
      .filter((transfer) => String(transfer.to_address || '').toLowerCase() === walletAddress.toLowerCase())
      .filter((transfer) => Number(transfer.value) > 0);
    const largest = incoming.sort((left, right) => Number(right.value || 0) - Number(left.value || 0))[0];
    if (!largest) return { price: 0, timestamp: 0 };
    const timestamp = largest.block_timestamp ? new Date(largest.block_timestamp).getTime() : 0;
    const price = largest.block_number ? await fetchMoralisPrice(tokenAddress, chain, largest.block_number) : 0;
    return { price, timestamp };
  } catch {
    return { price: 0, timestamp: 0 };
  }
}

async function estimateAssetPerformance(walletAddress: string, asset: WalletAsset, period: string) {
  if (!asset.rawValue || asset.rawValue <= 1 || asset.currentPrice <= 0) return;
  const chain = asset.chain || 'All Chains';
  let entry = { price: 0, timestamp: 0 };

  if (chain !== 'Solana') {
    entry = await estimateEvmCostBasis(walletAddress, asset);
  }

  let referencePrice = entry.price;
  if (period !== 'ALL') {
    const lookbackMs = period === '1D' ? 86_400_000
      : period === '1W' ? 7 * 86_400_000
        : period === '1M' || period === '>1M' ? 30 * 86_400_000
          : 0;
    const startSeconds = Math.floor((Date.now() - lookbackMs) / 1000);
    if (lookbackMs > 0 && (!entry.timestamp || entry.timestamp < startSeconds * 1000)) {
      if (chain === 'Solana') {
        referencePrice = await fetchMoralisPrice(asset.address, chain, undefined, startSeconds);
      } else if (chain !== 'All Chains') {
        const block = await fetchMoralisDateToBlock(chain as EvmWalletChain, startSeconds);
        referencePrice = block ? await fetchMoralisPrice(asset.address.includes(':native') ? nativeCostBasisToken(chain) : asset.address, chain, block) : referencePrice;
      }
    }
  }

  if (referencePrice > 0) {
    const pnlPercent = ((asset.currentPrice - referencePrice) / referencePrice) * 100;
    asset.pnlPercent = pnlPercent;
    asset.pnl = `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`;
    asset.avgBuy = formatUsd(referencePrice, referencePrice >= 1 ? 4 : 8);
  } else {
    asset.pnl = 'N/A';
  }
  if (entry.timestamp > 0) asset.buyTime = entry.timestamp;
}

async function enrichAssets(walletAddress: string, assets: WalletAsset[], period: string) {
  await priceMissingAssets(assets);
  const candidates = assets
    .filter((asset) => asset.rawValue > 1 && asset.currentPrice > 0)
    .sort((left, right) => right.rawValue - left.rawValue)
    .slice(0, 30);
  await Promise.all(candidates.map((asset) => estimateAssetPerformance(walletAddress, asset, period)));
}

async function fetchMoralisPrice(address: string, chain: WalletChain, block?: string, timestamp?: number) {
  if (!getMoralisKey()) return 0;

  const isSolana = chain === 'Solana';
  const url = new URL(isSolana
    ? `${MORALIS_SOLANA_BASE_URL}/token/mainnet/${address}/price`
    : `${MORALIS_EVM_BASE_URL}/erc20/${address}/price`);
  if (!isSolana) url.searchParams.set('chain', evmChainMap[chain as EvmWalletChain].moralis);
  if (block && !isSolana) url.searchParams.set('to_block', block);
  if (timestamp && isSolana) url.searchParams.set('toDate', new Date(timestamp * 1000).toISOString());

  try {
    const data = await moralisJson<{ usdPrice?: number; usd_price?: number }>(url.toString());
    return parseNumber(data.usdPrice ?? data.usd_price);
  } catch {
    return 0;
  }
}

async function fetchMoralisDateToBlock(chain: EvmWalletChain, timestampSeconds: number) {
  if (!getMoralisKey()) return null;
  const url = new URL(`${MORALIS_EVM_BASE_URL}/dateToBlock`);
  url.searchParams.set('chain', evmChainMap[chain].moralis);
  url.searchParams.set('date', new Date(timestampSeconds * 1000).toISOString());
  try {
    const data = await moralisJson<{ block?: number }>(url.toString());
    return Number.isFinite(Number(data.block)) ? String(data.block) : null;
  } catch {
    return null;
  }
}

type DexScreenerPair = {
  chainId?: string;
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string | number;
  liquidity?: { usd?: string | number };
  info?: { imageUrl?: string };
};

async function fetchDexScreenerPrices(chain: WalletChain, tokenAddresses: string[]) {
  const chainId = dexScreenerChainMap[chain];
  const addresses = [...new Set(tokenAddresses.map((address) => address.trim().toLowerCase()).filter((address) => /^0x[a-f0-9]{40}$/i.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)))];
  const prices = new Map<string, { price: number; logo?: string }>();
  if (!chainId || !addresses.length) return prices;

  for (let index = 0; index < addresses.length; index += 30) {
    const chunk = addresses.slice(index, index + 30);
    try {
      const response = await fetch(`https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chainId)}/${chunk.map(encodeURIComponent).join(',')}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) continue;
      const pairs = await response.json().catch(() => []) as DexScreenerPair[];
      const bestByAddress = new Map<string, DexScreenerPair>();
      for (const pair of Array.isArray(pairs) ? pairs : []) {
        const pairChain = String(pair.chainId || '').toLowerCase();
        if (pairChain && pairChain !== chainId.toLowerCase()) continue;
        const candidates = [pair.baseToken?.address, pair.quoteToken?.address]
          .map((value) => String(value || '').toLowerCase())
          .filter((value) => chunk.includes(value));
        for (const address of candidates) {
          const current = bestByAddress.get(address);
          if (!current || Number(pair.liquidity?.usd || 0) > Number(current.liquidity?.usd || 0)) {
            bestByAddress.set(address, pair);
          }
        }
      }
      bestByAddress.forEach((pair, address) => {
        const price = parseNumber(pair.priceUsd);
        if (price > 0) prices.set(address, { price, logo: pair.info?.imageUrl });
      });
    } catch {
      // Long-tail token pricing is a best-effort enhancement.
    }
  }

  return prices;
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
    rawBalance: balance,
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
        rawBalance: balance,
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
    rawBalance: nativeBalance,
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
      rawBalance: balance,
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
    rawBalance: balance,
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
        rawBalance: amount,
        logo: token.logo || token.thumbnail,
        chain: 'Solana',
        chainLogo: SOLANA_LOGO,
        pnl: value > 1 ? 'Loading...' : 'N/A'
      } satisfies WalletAsset;
    }));
}

async function fetchSolanaPortfolio(address: string, period: string) {
  if (!getMoralisKey() && !getHeliusKey()) {
    return providerMissing('Add MORALIS_API_KEY and HELIUS_API_KEY to .env to load Solana wallet holdings.');
  }

  const [nativeResult, tokenResult] = await Promise.allSettled([
    fetchHeliusNativeSol(address),
    fetchMoralisSolanaTokens(address)
  ]);

  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
  let tokens: WalletAsset[] = tokenResult.status === 'fulfilled' ? tokenResult.value : [];
  const assets = [native, ...tokens].filter(Boolean) as WalletAsset[];
  await enrichAssets(address, assets, period);

  return portfolioFromAssets(
    assets,
    'No visible Solana holdings found.'
  );
}

async function loadPortfolio(address: string, chain: WalletChain, period: string): Promise<WalletPortfolioResponse> {
  const isSolanaAddress = !address.startsWith('0x');
  if (isSolanaAddress && (chain === 'All Chains' || chain === 'Solana')) return fetchSolanaPortfolio(address, period);

  if (chain === 'Solana') return fetchSolanaPortfolio(address, period);

  if (!getMoralisKey() && !getAlchemyKey()) {
    return providerMissing('Add MORALIS_API_KEY or ALCHEMY_API_KEY to .env to load EVM wallet holdings.');
  }

  if (chain === 'All Chains') {
    const results = await Promise.allSettled(evmAggregateChains.map((item) => fetchEvmChain(address, item)));
    const assets = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    if (!assets.length) {
      return providerMissing('No EVM balances returned for this wallet.');
    }
    await enrichAssets(address, assets, period);
    return portfolioFromAssets(assets);
  }

  const assets = await fetchEvmChain(address, chain);
  if (!assets.length && !getMoralisKey()) {
    return providerMissing('No EVM balances returned for this wallet.');
  }

  await enrichAssets(address, assets, period);
  return portfolioFromAssets(assets);
}

export class WalletPortfolioService {
  async getPortfolio(address: string, chain: WalletChain, period: string) {
    const key = `${chain}:${address.toLowerCase()}:${period}`;
    const cached = cache.get(key);
    if (cached) return cached.value as WalletPortfolioResponse;

    const existing = pending.get(key);
    if (existing) return existing;

    const request = loadPortfolio(address, chain, period)
      .then((portfolio) => {
        cache.set(key, portfolio, WALLET_CACHE_TTL_MS, portfolio.generatedAt);
        return portfolio;
      })
      .finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }
}
