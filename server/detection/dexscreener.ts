import type { OverviewToken } from '../../src/shared/overview';
import type { ChainId, Token, TokenRecord, TokenSnapshot } from './types';

const BASE_URL = 'https://api.dexscreener.com';
const REQUEST_TIMEOUT_MS = 12_000;

type DexPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: {
    address?: string;
    name?: string;
    symbol?: string;
  };
  priceUsd?: string;
  txns?: {
    m5?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  info?: { imageUrl?: string };
};

export type DetectionCandidate = OverviewToken;

export async function hydrateDetectionCandidate(candidate: DetectionCandidate): Promise<TokenRecord | null> {
  const chain = getDexScreenerChainId(candidate.chain);
  if (!chain || !candidate.address) return null;

  const pairs = await fetchJson<DexPair[]>(`/token-pairs/v1/${encodeURIComponent(chain)}/${encodeURIComponent(candidate.address)}`);
  const pair = selectBestPair(pairs, candidate.pairAddress);
  return pair ? toRecord(pair, candidate, chain) : null;
}

function selectBestPair(pairs: DexPair[], preferredPairAddress = '') {
  const preferred = preferredPairAddress.trim().toLowerCase();
  if (preferred) {
    const match = pairs.find((pair) => String(pair.pairAddress || '').toLowerCase() === preferred);
    if (match) return match;
  }
  return pairs
    .filter((pair) => pair.baseToken?.address && pair.pairAddress)
    .sort((left, right) => scorePair(right) - scorePair(left))[0] || null;
}

function scorePair(pair: DexPair) {
  return Number(pair.volume?.m5 || 0) * 2 + Number(pair.volume?.h1 || 0) + Number(pair.liquidity?.usd || 0) * 0.05;
}

function toRecord(pair: DexPair, candidate: DetectionCandidate, chain: ChainId): TokenRecord {
  if (!pair.baseToken?.address || !pair.pairAddress) {
    throw new Error('DexScreener pair is missing required token fields.');
  }

  const tokenId = `${chain}:${pair.pairAddress}`;
  const timestamp = new Date().toISOString();
  const buys5m = Number(pair.txns?.m5?.buys || 0);
  const sells5m = Number(pair.txns?.m5?.sells || 0);

  const token: Token = {
    tokenId,
    tokenName: pair.baseToken.name || candidate.name || null,
    tokenSymbol: pair.baseToken.symbol || candidate.symbol || null,
    tokenAddress: pair.baseToken.address,
    chain,
    pairAddress: pair.pairAddress,
    dexId: pair.dexId || candidate.dex || null,
    pairUrl: pair.url || candidate.url || null
  };

  const snapshot: TokenSnapshot = {
    tokenId,
    timestamp,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : candidate.priceUsd,
    marketCap: pair.marketCap ?? pair.fdv ?? candidate.marketCapUsd,
    liquidityUsd: pair.liquidity?.usd ?? candidate.liquidityUsd,
    volume5m: Number(pair.volume?.m5 || 0),
    volume1h: Number(pair.volume?.h1 || 0),
    volume6h: Number(pair.volume?.h6 || 0),
    volume24h: Number(pair.volume?.h24 ?? candidate.volume24hUsd ?? 0),
    buys5m,
    sells5m,
    traders5m: buys5m + sells5m,
    priceChange5m: Number(pair.priceChange?.m5 || 0),
    priceChange1h: Number(pair.priceChange?.h1 || 0),
    priceChange6h: Number(pair.priceChange?.h6 || 0),
    priceChange24h: Number(pair.priceChange?.h24 ?? candidate.change24h ?? 0),
    raw: {
      pair,
      overview: candidate,
      logo: pair.info?.imageUrl || candidate.logo || null
    }
  };

  return { token, snapshot };
}

export function getDexScreenerChainId(chain: string | undefined): string {
  const normalized = String(chain || '').trim().toLowerCase();
  if (!normalized) return '';
  if (['eth', 'ethereum'].includes(normalized)) return 'ethereum';
  if (['bnb', 'bsc', 'binance', 'binance smart chain', 'bnb chain'].includes(normalized)) return 'bsc';
  if (['sol', 'solana'].includes(normalized)) return 'solana';
  if (['poly', 'polygon', 'matic'].includes(normalized)) return 'polygon';
  if (['arb', 'arbitrum'].includes(normalized)) return 'arbitrum';
  if (['op', 'optimism'].includes(normalized)) return 'optimism';
  if (['avax', 'avalanche'].includes(normalized)) return 'avalanche';
  return normalized;
}

async function fetchJson<T>(path: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      if (!response.ok) {
        throw new Error(`DexScreener ${path} failed: ${response.status} ${response.statusText}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(650 * attempt);
    }
  }

  throw lastError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
