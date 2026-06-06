import { apiUrl } from '../../config';
import type { InsightXNetwork, SafeScanReport } from '../../shared/insightx';

export type DexPairDetails = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceNative?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url?: string }>;
    socials?: Array<{ type?: string; url?: string }>;
  };
};

export type TokenDetailsResponse = {
  generatedAt: string;
  pair: DexPairDetails;
  pairs: DexPairDetails[];
  poolCount: number;
};

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export const TokenDetailsService = {
  getToken(address: string, chain: string, pair = '') {
    const params = new URLSearchParams({ address, chain });
    if (pair) params.set('pair', pair);
    return fetchJson<TokenDetailsResponse>(`/api/overview/token?${params.toString()}`);
  },

  getInsightXReport(network: InsightXNetwork, address: string) {
    const params = new URLSearchParams({ network, address });
    return fetchJson<SafeScanReport>(`/api/insightx/report?${params.toString()}`);
  }
};
