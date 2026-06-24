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
const inFlightNetworkDetections = new Map<string, Promise<DetectedTokenNetwork | null>>();
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
const bubblemapsChainByDexId = Object.entries(dexscreenerChainIds).reduce((lookup, [chain, dexId]) => {
  if (dexId) lookup[dexId] = chain as BubblemapsChain;
  return lookup;
}, {} as Record<string, BubblemapsChain>);
const API_REQUEST_TIMEOUT_MS = 35_000;
const SCAN_REPORT_TIMEOUT_MS = 75_000;
const DEXSCREENER_REQUEST_TIMEOUT_MS = 7_000;
const DEXSCREENER_DETECTION_TIMEOUT_MS = 3_000;

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError' ||
    error instanceof Error && /aborted|abort/i.test(error.message);
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error('The request timed out. Please try again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchJson<T>(path: string, timeoutMs = API_REQUEST_TIMEOUT_MS): Promise<T> {
  const response = await fetchWithTimeout(apiUrl(path), timeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

async function getDexScreenerTokenPairs(chain: BubblemapsChain, address: string) {
  const chainId = dexscreenerChainIds[chain];
  if (!chainId) return [];
  const response = await fetchWithTimeout(
    `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address.trim())}`,
    DEXSCREENER_REQUEST_TIMEOUT_MS
  );
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
  const response = await fetchWithTimeout(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address.trim())}`,
    DEXSCREENER_DETECTION_TIMEOUT_MS
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const pairs: any[] = Array.isArray(payload?.pairs) ? payload.pairs : [];
  const pairsByChain = pairs.reduce<Partial<Record<BubblemapsChain, any[]>>>((groups, pair: any) => {
    const chain = bubblemapsChainByDexId[String(pair?.chainId || '').toLowerCase()];
    if (chain && dexDetectionChains.includes(chain)) {
      groups[chain] = [...(groups[chain] || []), pair];
    }
    return groups;
  }, {});
  const candidates = Object.entries(pairsByChain).map(([chain, chainPairs]) => {
    const totals = summarizeDexScreenerPairs(chainPairs, address);
    return {
      chain: chain as BubblemapsChain,
      pairs: chainPairs,
      ...totals
    };
  });
  const best = candidates
    .filter((item) => item.pairCount > 0 || item.liquidityUsd > 0)
    .sort((left, right) => right.liquidityUsd - left.liquidityUsd || right.pairCount - left.pairCount)[0];

  if (!best) return null;
  const firstPair = best.pairs.find((pair: any) => {
    const normalizedAddress = address.trim().toLowerCase();
    return String(pair?.baseToken?.address || '').toLowerCase() === normalizedAddress ||
      String(pair?.quoteToken?.address || '').toLowerCase() === normalizedAddress;
  }) || best.pairs[0];
  const matchedToken = String(firstPair?.baseToken?.address || '').toLowerCase() === address.trim().toLowerCase()
    ? firstPair?.baseToken
    : firstPair?.quoteToken;
  return {
    chain: best.chain,
    address,
    confidence: best.liquidityUsd > 0 ? 'high' : 'medium',
    source: 'DexScreener liquidity',
    matches: [{
      chain: best.chain,
      name: matchedToken?.name || null,
      symbol: matchedToken?.symbol || null,
      transfersCount: null
    }]
  };
}

async function detectTokenNetworkRequest(address: string): Promise<DetectedTokenNetwork | null> {
  const value = address.trim();
  if (!value) return null;
  if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
    const dexDetection = await detectNetworkFromDexScreener(value).catch(() => null);
    if (dexDetection) return dexDetection;

    const params = new URLSearchParams({ address: value });
    const detection = await fetchJson<DetectedTokenNetwork | null>(`/api/bubblemaps/detect-network?${params.toString()}`);
    const parsedDetection = detection ? TokenNetworkDetectionSchema.parse(detection) as DetectedTokenNetwork : null;
    if (parsedDetection?.source === 'Bubblemaps token metadata') return parsedDetection;
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
    const request = fetchJson<BubblemapsScanReport>(`/api/bubblemaps/report?${params.toString()}`, SCAN_REPORT_TIMEOUT_MS).then((report) => {
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
    const key = value.toLowerCase();
    const inFlight = inFlightNetworkDetections.get(key);
    if (inFlight) return inFlight;
    const request = detectTokenNetworkRequest(value).finally(() => {
      inFlightNetworkDetections.delete(key);
    });
    inFlightNetworkDetections.set(key, request);
    return request;
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
