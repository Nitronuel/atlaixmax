export type InsightXNetwork = 'sol' | 'eth' | 'base' | 'bsc' | 'monad' | 'xlayer' | 'abs' | 'sui';

export type EndpointStatus = 'available' | 'unsupported' | 'missing' | 'error' | 'rate_limited' | 'not_configured';

export type EndpointResult<T = unknown> = {
  status: EndpointStatus;
  data: T | null;
  error?: string;
  httpStatus?: number;
  cached?: boolean;
  cachedAt?: string;
  fetchedAt: string;
  retryAfter?: string | null;
};

export type InsightXToken = {
  address: string;
  name?: string | null;
  symbol?: string | null;
  logo?: string | null;
  decimals?: number | null;
  total_supply?: number | null;
  age?: number | null;
};

export type ScannerResponse = {
  network?: { name?: string; symbol?: string };
  token?: InsightXToken;
  results?: {
    generated_at?: number;
    simple?: {
      score?: number;
      message?: string;
      reasons?: string[];
    };
    advanced?: Record<string, unknown>;
  };
};

export type DexMetrics = {
  cluster_pct?: number;
  snipers_pct?: number;
  bundlers_pct?: number;
  dev_pct?: number;
  insiders_pct?: number;
  top10_pct?: number;
};

export type WalletEntry = {
  address?: string;
  wallet?: string;
  owner?: string;
  balance?: number;
  amount?: number;
  token_balance?: number;
  percentage?: number;
  pct?: number;
  supply_pct?: number;
  total_pct?: number;
  label?: string;
  tags?: string[];
  smart_contract?: boolean;
  reasons?: string[] | null;
};

export type SnipersResponse = {
  total_sniper_pct?: number;
  count?: {
    total?: number;
    sold_partially?: number;
    sold_fully?: number;
    bought_more?: number;
  };
  snipers?: WalletEntry[];
};

export type BundlersResponse = {
  total_bundlers_pct?: number;
  bundlers?: WalletEntry[];
};

export type InsidersResponse = {
  total_insiders_pct?: number;
  insiders?: WalletEntry[];
};

export type LabelResponse = {
  address: string;
  label: string;
  tags?: string[];
  smart_contract: boolean;
};

export type AtlasSnapshot = {
  nodes?: Array<Record<string, unknown>>;
  holders?: Array<Record<string, unknown>>;
  links?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
  token?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SafeScanReport = {
  network: InsightXNetwork;
  address: string;
  generatedAt: string;
  source: 'insightx';
  endpoints: {
    scanner: EndpointResult<ScannerResponse>;
    overview: EndpointResult<DexMetrics>;
    clusters: EndpointResult<unknown>;
    snipers: EndpointResult<SnipersResponse>;
    bundlers: EndpointResult<BundlersResponse>;
    insiders: EndpointResult<InsidersResponse>;
    atlasLatest: EndpointResult<AtlasSnapshot>;
    atlasTimestamps: EndpointResult<unknown>;
    labels: EndpointResult<LabelResponse[]>;
  };
};

export const INSIGHTX_NETWORKS: Array<{ id: InsightXNetwork; label: string; family: 'Solana' | 'EVM' | 'Sui' }> = [
  { id: 'sol', label: 'Solana', family: 'Solana' },
  { id: 'eth', label: 'Ethereum', family: 'EVM' },
  { id: 'base', label: 'Base', family: 'EVM' },
  { id: 'bsc', label: 'BNB Chain', family: 'EVM' },
  { id: 'monad', label: 'Monad', family: 'EVM' },
  { id: 'xlayer', label: 'X Layer', family: 'EVM' },
  { id: 'abs', label: 'Abstract', family: 'EVM' },
  { id: 'sui', label: 'Sui', family: 'Sui' }
];

export const INSIGHTX_SUPPORTED_NETWORKS = new Set<InsightXNetwork>(INSIGHTX_NETWORKS.map((network) => network.id));

export function normalizeInsightXNetwork(value: string | null | undefined): InsightXNetwork | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'ethereum') return 'eth';
  if (normalized === 'solana') return 'sol';
  if (normalized === 'bnb' || normalized === 'bnbchain') return 'bsc';
  return INSIGHTX_SUPPORTED_NETWORKS.has(normalized as InsightXNetwork) ? normalized as InsightXNetwork : null;
}

export function isLikelyInsightXAddress(address: string, network: InsightXNetwork) {
  const value = address.trim();
  if (!value) return false;
  if (network === 'sol') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  if (network === 'sui') return /^0x[a-fA-F0-9]{40,}$/.test(value) || value.length > 44;
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function getInsightXNetworkLabel(network: InsightXNetwork) {
  return INSIGHTX_NETWORKS.find((item) => item.id === network)?.label || network.toUpperCase();
}
