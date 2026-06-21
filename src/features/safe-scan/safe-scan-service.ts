import { apiUrl } from '../../config';
import {
  type BubblemapsChain,
  type BubblemapsScanReport,
  type TokenNetworkDetection,
  BUBBLEMAPS_CHAINS,
  isLikelyBubblemapsAddress
} from '../../shared/bubblemaps';
import { BubblemapsScanReportSchema, TokenNetworkDetectionSchema } from '../../shared/bubblemaps-schema';
import type { SecurityScannerReport } from '../../shared/security-scanner';

export type DetectedTokenNetwork = TokenNetworkDetection;

export type LiveTokenLiquidity = {
  tokenLiquidity: number;
  liquidityUsd: number;
  tokenPriceUsd: number | null;
  pairCount: number;
  source: string;
};

const inFlightReports = new Map<string, Promise<BubblemapsScanReport>>();
const evmChains = BUBBLEMAPS_CHAINS.filter((item) => item.family === 'EVM').map((item) => item.id);
const dexscreenerChainIds: Partial<Record<BubblemapsChain, string>> = {
  eth: 'ethereum',
  base: 'base',
  solana: 'solana',
  bsc: 'bsc',
  sonic: 'sonic',
  avalanche: 'avalanche',
  polygon: 'polygon',
  monad: 'monad',
  hyperevm: 'hyperevm',
  arbitrum: 'arbitrum'
};

const dexDetectionChains = BUBBLEMAPS_CHAINS
  .filter((item) => item.family === 'EVM' && dexscreenerChainIds[item.id])
  .map((item) => item.id);

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

async function getDexScreenerTokenPairs(chain: BubblemapsChain, address: string) {
  const chainId = dexscreenerChainIds[chain];
  if (!chainId) return [];
  const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address.trim())}`);
  if (!response.ok) return [];
  const pairs = await response.json().catch(() => []);
  return Array.isArray(pairs) ? pairs : [];
}

function summarizeDexScreenerPairs(pairs: any[], address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  return pairs.reduce((total, pair: any) => {
    const liquidity = pair?.liquidity || {};
    const liquidityUsd = Number(liquidity.usd);
    const priceUsd = Number(pair?.priceUsd);
    const baseAddress = String(pair?.baseToken?.address || '').toLowerCase();
    const quoteAddress = String(pair?.quoteToken?.address || '').toLowerCase();
    const tokenLiquidity = baseAddress === normalizedAddress
      ? Number(liquidity.base)
      : quoteAddress === normalizedAddress
        ? Number(liquidity.quote)
        : NaN;

    if (Number.isFinite(tokenLiquidity) && tokenLiquidity > 0) {
      total.tokenLiquidity += tokenLiquidity;
      total.pairCount += 1;
      if (Number.isFinite(priceUsd) && priceUsd > 0) {
        total.weightedPriceTotal += priceUsd * tokenLiquidity;
        total.priceWeight += tokenLiquidity;
      }
    }
    if (Number.isFinite(liquidityUsd) && liquidityUsd > 0) total.liquidityUsd += liquidityUsd;
    return total;
  }, { tokenLiquidity: 0, liquidityUsd: 0, weightedPriceTotal: 0, priceWeight: 0, pairCount: 0 });
}

async function detectNetworkFromDexScreener(address: string): Promise<DetectedTokenNetwork | null> {
  const candidates = await Promise.all(dexDetectionChains.map(async (chain) => {
    const pairs = await getDexScreenerTokenPairs(chain, address);
    const totals = summarizeDexScreenerPairs(pairs, address);
    return {
      chain,
      pairs,
      ...totals
    };
  }));
  const best = candidates
    .filter((item) => item.pairCount > 0 || item.liquidityUsd > 0)
    .sort((left, right) => right.liquidityUsd - left.liquidityUsd || right.pairCount - left.pairCount)[0];

  if (!best) return null;
  const firstPair = best.pairs[0];
  return {
    chain: best.chain,
    address,
    confidence: best.liquidityUsd > 0 ? 'high' : 'medium',
    source: 'DexScreener liquidity',
    matches: [{
      chain: best.chain,
      name: firstPair?.baseToken?.name || null,
      symbol: firstPair?.baseToken?.symbol || null,
      transfersCount: null
    }]
  };
}

export const SafeScanService = {
  async scanToken(chain: BubblemapsChain, address: string) {
    const normalizedAddress = address.trim();
    if (!isLikelyBubblemapsAddress(normalizedAddress, chain)) {
      if (chain === 'solana') throw new Error('Solana scans require a valid Solana token address.');
      if (chain === 'tron') throw new Error('Tron scans require a valid Tron token address.');
      if (chain === 'ton') throw new Error('TON scans require a valid TON token address.');
      throw new Error('EVM scans require a valid 0x token address.');
    }

    const key = `${chain}:${normalizedAddress.toLowerCase()}`;
    const inFlight = inFlightReports.get(key);
    if (inFlight) return inFlight;
    const params = new URLSearchParams({ chain, address: normalizedAddress });
    const request = fetchJson<BubblemapsScanReport>(`/api/bubblemaps/report?${params.toString()}`).then((report) => {
      const parsed = BubblemapsScanReportSchema.parse(report) as BubblemapsScanReport;
      const endpoints = Object.values(parsed.endpoints);
      const configError = endpoints.find((endpoint) => endpoint.status === 'not_configured');
      if (configError) throw new Error(configError.error || 'Bubblemaps API key is not configured.');
      return parsed;
    }).finally(() => {
      inFlightReports.delete(key);
    });
    inFlightReports.set(key, request);
    return request;
  },

  async detectTokenNetwork(address: string): Promise<DetectedTokenNetwork | null> {
    const value = address.trim();
    if (!value) return null;
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      const params = new URLSearchParams({ address: value });
      const detection = await fetchJson<DetectedTokenNetwork | null>(`/api/bubblemaps/detect-network?${params.toString()}`);
      const parsedDetection = detection ? TokenNetworkDetectionSchema.parse(detection) as DetectedTokenNetwork : null;
      if (parsedDetection?.source === 'Bubblemaps token metadata') return parsedDetection;
      const dexDetection = await detectNetworkFromDexScreener(value);
      if (dexDetection) return dexDetection;
      return parsedDetection || {
        chain: evmChains.includes('eth') ? 'eth' : evmChains[0],
        address: value,
        confidence: 'low',
        source: 'Address format',
        matches: []
      };
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      return {
        chain: 'solana',
        address: value,
        confidence: 'medium',
        source: 'Address format',
        matches: []
      };
    }
    if (/^T[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(value)) {
      return {
        chain: 'tron',
        address: value,
        confidence: 'medium',
        source: 'Address format',
        matches: []
      };
    }
    return null;
  },

  async getLiveTokenLiquidity(chain: BubblemapsChain, address: string): Promise<LiveTokenLiquidity | null> {
    const pairs = await getDexScreenerTokenPairs(chain, address);
    const totals = summarizeDexScreenerPairs(pairs, address);
    if (totals.tokenLiquidity <= 0 && totals.liquidityUsd <= 0) return null;
    return {
      tokenLiquidity: totals.tokenLiquidity,
      liquidityUsd: totals.liquidityUsd,
      tokenPriceUsd: totals.priceWeight > 0 ? totals.weightedPriceTotal / totals.priceWeight : null,
      pairCount: totals.pairCount,
      source: 'DexScreener'
    };
  },

  async getSecurityScannerReport(chain: BubblemapsChain, address: string): Promise<SecurityScannerReport> {
    const params = new URLSearchParams({ chain, address: address.trim() });
    return fetchJson<SecurityScannerReport>(`/api/security-scanner/token?${params.toString()}`);
  }
};
