export type BubblemapsChain = 'eth' | 'base' | 'solana' | 'tron' | 'bsc' | 'sonic' | 'ton' | 'avalanche' | 'polygon' | 'monad' | 'hyperevm' | 'arbitrum';

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

export type ChainDetails = {
  id: BubblemapsChain;
  name: string;
  dexscreener_id?: string | null;
  coingecko_id?: string | null;
};

export type TokenKey = {
  chain: BubblemapsChain;
  address: string;
};

export type TokenMetadata = {
  name: string;
  symbol: string;
  is_indexed: boolean;
  img_url?: string | null;
};

export type TokenAggregates = {
  transfers_count: number;
  min_date?: string | null;
  max_date?: string | null;
};

export type TokenDetails = {
  token_key: TokenKey;
  metadata: TokenMetadata;
  stats?: TokenAggregates | null;
};

export type AddressDetails = {
  label?: string | null;
  degree: number;
  is_supernode: boolean;
  is_contract: boolean;
  is_cex: boolean;
  is_dex: boolean;
  entity_id?: string | null;
  inward_relations: number;
  outward_relations: number;
  first_activity_date?: string | null;
};

export type AddressMetadata = {
  address: string;
  address_details: AddressDetails;
};

export type HolderData = {
  amount: number;
  rank: number;
  share: number;
};

export type TokenHolder = {
  address: string;
  address_details?: AddressDetails | null;
  holder_data: HolderData;
  is_shown_on_map?: boolean;
};

export type SupplyStats = {
  cexs: number;
  dexs: number;
  contracts: number;
  fresh_wallets: number;
  top_10_adjusted: number;
  bundles: number;
};

export type MapScores = {
  bubblemaps_score: number;
  gini_index: number;
  herfindahl_hirschman_index: number;
  nakamoto_coefficient: number;
};

export type TokenMetrics = {
  supply_stats: SupplyStats;
  scores: MapScores;
};

export type GroupedTransfer = {
  from_address: string;
  to_address: string;
  rel_type: 'GROUPED_TRANSFER';
  data: {
    total_value: number;
    total_transfers: number;
    first_date: number;
    last_date: number;
    token_key: TokenKey;
  };
};

export type TimeNode = {
  address: string;
  relationships: GroupedTransfer[];
};

export type NodesData = {
  top_holders: TokenHolder[];
  magic_nodes?: Array<{ address: string; address_details?: AddressDetails | null; is_shown_on_map?: boolean }> | null;
  time_nodes?: TimeNode[] | null;
};

export type ClusterData = {
  share: number;
  amount: number;
  holder_count: number;
  holders: string[];
};

export type TokenMap = {
  metadata: {
    dt_update?: string | null;
    ts_update?: number | null;
    [key: string]: unknown;
  };
  metrics: TokenMetrics;
  nodes?: NodesData | null;
  relationships?: GroupedTransfer[] | null;
  clusters?: ClusterData[] | null;
};

export type BubblemapsScanReport = {
  chain: BubblemapsChain;
  address: string;
  generatedAt: string;
  source: 'bubblemaps';
  endpoints: {
    token: EndpointResult<TokenDetails>;
    metrics: EndpointResult<TokenMetrics>;
    holders: EndpointResult<TokenHolder[]>;
    map: EndpointResult<TokenMap>;
    chains: EndpointResult<ChainDetails[]>;
  };
};

export type TokenNetworkDetection = {
  chain: BubblemapsChain;
  address: string;
  confidence: 'high' | 'medium' | 'low';
  source: string;
  matches: Array<{
    chain: BubblemapsChain;
    name?: string | null;
    symbol?: string | null;
    isIndexed?: boolean;
    transfersCount?: number | null;
  }>;
};

export const BUBBLEMAPS_CHAINS: Array<{ id: BubblemapsChain; label: string; family: 'EVM' | 'Solana' | 'Other' }> = [
  { id: 'eth', label: 'Ethereum', family: 'EVM' },
  { id: 'base', label: 'Base', family: 'EVM' },
  { id: 'solana', label: 'Solana', family: 'Solana' },
  { id: 'bsc', label: 'BNB Chain', family: 'EVM' },
  { id: 'arbitrum', label: 'Arbitrum', family: 'EVM' },
  { id: 'polygon', label: 'Polygon', family: 'EVM' },
  { id: 'avalanche', label: 'Avalanche', family: 'EVM' },
  { id: 'tron', label: 'Tron', family: 'Other' },
  { id: 'sonic', label: 'Sonic', family: 'EVM' },
  { id: 'ton', label: 'TON', family: 'Other' },
  { id: 'monad', label: 'Monad', family: 'EVM' },
  { id: 'hyperevm', label: 'HyperEVM', family: 'EVM' }
];

export const BUBBLEMAPS_SUPPORTED_CHAINS = new Set<BubblemapsChain>(BUBBLEMAPS_CHAINS.map((chain) => chain.id));

export function normalizeBubblemapsChain(value: string | null | undefined): BubblemapsChain | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'ethereum') return 'eth';
  if (normalized === 'sol') return 'solana';
  if (normalized === 'bnb' || normalized === 'bnbchain') return 'bsc';
  if (normalized === 'avax') return 'avalanche';
  if (normalized === 'arb') return 'arbitrum';
  return BUBBLEMAPS_SUPPORTED_CHAINS.has(normalized as BubblemapsChain) ? normalized as BubblemapsChain : null;
}

export function getBubblemapsChainLabel(chain: BubblemapsChain) {
  return BUBBLEMAPS_CHAINS.find((item) => item.id === chain)?.label || chain.toUpperCase();
}

export function isLikelyBubblemapsAddress(address: string, chain: BubblemapsChain) {
  const value = address.trim();
  if (!value) return false;
  if (chain === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
  if (chain === 'ton') return !value.toLowerCase().startsWith('0x') && value.length >= 32;
  if (chain === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(value);
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
