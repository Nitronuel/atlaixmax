import { apiUrl } from '../../config';
import {
  type InsightXNetwork,
  type SafeScanReport,
  INSIGHTX_NETWORKS,
  isLikelyInsightXAddress
} from '../../shared/insightx';
import { SafeScanReportSchema } from '../../shared/insightx-schema';

export type LiveTokenLiquidity = {
  tokenLiquidity: number;
  liquidityUsd: number;
  tokenPriceUsd: number | null;
  pairCount: number;
  source: 'DexScreener';
};

export type DetectedTokenNetwork = {
  network: InsightXNetwork;
  confidence: 'high' | 'medium' | 'low';
  source: string;
};

const inFlightReports = new Map<string, Promise<SafeScanReport>>();
const dexScreenerChainIds: Partial<Record<InsightXNetwork, string>> = {
  sol: 'solana',
  eth: 'ethereum',
  base: 'base',
  bsc: 'bsc',
  monad: 'monad',
  xlayer: 'xlayer',
  abs: 'abstract',
  sui: 'sui'
};
const evmNetworks = INSIGHTX_NETWORKS.filter((item) => item.family === 'EVM').map((item) => item.id);

type PairSummary = {
  tokenLiquidity: number;
  liquidityUsd: number;
  weightedPriceTotal: number;
  priceWeight: number;
  pairCount: number;
};

type DexScreenerPair = {
  priceUsd?: string | number;
  liquidity?: {
    usd?: string | number;
    base?: string | number;
    quote?: string | number;
  };
  baseToken?: {
    address?: string;
  };
  quoteToken?: {
    address?: string;
  };
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

async function getDexScreenerTokenPairs(network: InsightXNetwork, address: string) {
  const chainId = dexScreenerChainIds[network];
  if (!chainId) return [];
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address.trim())}`);
  if (!response.ok) return [];
  const pairs = await response.json().catch(() => []);
  return Array.isArray(pairs) ? pairs : [];
}

function summarizePairs(pairs: unknown[], address: string): PairSummary {
  const normalized = address.trim().toLowerCase();
  return pairs.reduce<PairSummary>((summary, pairValue) => {
    const pair = pairValue as DexScreenerPair;
    const liquidity = pair.liquidity || {};
    const baseAddress = String(pair.baseToken?.address || '').toLowerCase();
    const quoteAddress = String(pair.quoteToken?.address || '').toLowerCase();
    const priceUsd = Number(pair.priceUsd);
    const liquidityUsd = Number(liquidity.usd);
    const tokenLiquidity = baseAddress === normalized
      ? Number(liquidity.base)
      : quoteAddress === normalized
        ? Number(liquidity.quote)
        : Number.NaN;

    if (Number.isFinite(tokenLiquidity) && tokenLiquidity > 0) {
      summary.tokenLiquidity += tokenLiquidity;
      summary.pairCount += 1;
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        summary.weightedPriceTotal += priceUsd * tokenLiquidity;
        summary.priceWeight += tokenLiquidity;
      }
    }
    if (Number.isFinite(liquidityUsd) && liquidityUsd > 0) {
      summary.liquidityUsd += liquidityUsd;
    }
    return summary;
  }, { tokenLiquidity: 0, liquidityUsd: 0, weightedPriceTotal: 0, priceWeight: 0, pairCount: 0 });
}

export const SafeScanService = {
  async scanToken(network: InsightXNetwork, address: string) {
    const normalizedAddress = address.trim();
    if (!isLikelyInsightXAddress(normalizedAddress, network)) {
      if (network === 'sol') throw new Error('Solana scans require a valid Solana address.');
      if (network === 'sui') throw new Error('Sui scans require a valid Sui token address.');
      throw new Error('EVM scans require a valid 0x token address.');
    }

    const key = `${network}:${normalizedAddress.toLowerCase()}`;
    const inFlight = inFlightReports.get(key);
    if (inFlight) return inFlight;
    const params = new URLSearchParams({ network, address: normalizedAddress });
    const request = fetchJson<SafeScanReport>(`/api/insightx/report?${params.toString()}`).then((report) => SafeScanReportSchema.parse(report)).finally(() => {
      inFlightReports.delete(key);
    });
    inFlightReports.set(key, request);
    return request;
  },

  async detectTokenNetwork(address: string): Promise<DetectedTokenNetwork | null> {
    const value = address.trim();
    if (!value) return null;
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      const candidates = await Promise.all(evmNetworks.map(async (network): Promise<PairSummary & { network: InsightXNetwork }> => {
        const pairs = await getDexScreenerTokenPairs(network, value);
        return { network, ...summarizePairs(pairs, value) };
      }));
      const best = candidates
        .filter((item) => item.pairCount > 0 || item.liquidityUsd > 0)
        .sort((left, right) => right.liquidityUsd - left.liquidityUsd || right.pairCount - left.pairCount)[0];
      return best
        ? { network: best.network, confidence: best.liquidityUsd > 0 ? 'high' : 'medium', source: 'DexScreener' }
        : { network: 'eth', confidence: 'low', source: 'Address format' };
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      return { network: 'sol', confidence: 'medium', source: 'Address format' };
    }
    if (value.length > 44) {
      return { network: 'sui', confidence: 'low', source: 'Address format' };
    }
    return null;
  },

  async getLiveTokenLiquidity(network: InsightXNetwork, address: string): Promise<LiveTokenLiquidity | null> {
    const pairs = await getDexScreenerTokenPairs(network, address);
    const totals = summarizePairs(pairs, address);
    if (totals.tokenLiquidity <= 0 && totals.liquidityUsd <= 0) return null;
    return {
      tokenLiquidity: totals.tokenLiquidity,
      liquidityUsd: totals.liquidityUsd,
      tokenPriceUsd: totals.priceWeight > 0 ? totals.weightedPriceTotal / totals.priceWeight : null,
      pairCount: totals.pairCount,
      source: 'DexScreener'
    };
  }
};
