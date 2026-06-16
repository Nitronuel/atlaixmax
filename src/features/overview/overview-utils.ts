import type { OverviewToken } from '../../shared/overview';

export type OverviewFilters = {
  visibleCount: string;
  chain: string;
  event: string;
  marketCapMin: string;
  marketCapMax: string;
  liquidityMin: string;
  liquidityMax: string;
  changeMin: string;
  changeMax: string;
  volumeMin: string;
  volumeMax: string;
};

export type SortConfig = {
  key: OverviewSortKey;
  direction: 'asc' | 'desc';
} | null;

export type OverviewSortKey =
  | 'chain'
  | 'symbol'
  | 'event'
  | 'priceUsd'
  | 'change24h'
  | 'marketCapUsd'
  | 'volume24hUsd'
  | 'liquidityUsd'
  | 'dexBuys24h'
  | 'dexSells24h'
  | 'dexFlow24h';

export const DEFAULT_OVERVIEW_FILTERS: OverviewFilters = {
  visibleCount: '100',
  chain: 'all',
  event: 'all',
  marketCapMin: '',
  marketCapMax: '',
  liquidityMin: '',
  liquidityMax: '',
  changeMin: '',
  changeMax: '',
  volumeMin: '',
  volumeMax: ''
};

export function formatUsd(value: unknown, fallback = 'N/A') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (Math.abs(numeric) >= 1_000_000_000) return `$${(numeric / 1_000_000_000).toFixed(2)}B`;
  if (Math.abs(numeric) >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1_000) return `$${(numeric / 1_000).toFixed(2)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: numeric >= 1 ? 2 : 6 }).format(numeric);
}

export function formatPrice(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'N/A';
  if (numeric < 0.000001) return `$${numeric.toExponential(2)}`;
  if (numeric < 0.01) return `$${numeric.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
  if (numeric < 1) return `$${numeric.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  return `$${numeric.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
}

export function formatPercentValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'N/A';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}%`;
}

export function formatInteger(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numeric);
}

export function parseFilterNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function tokenSearchText(token: OverviewToken) {
  return `${token.symbol} ${token.name} ${token.address} ${token.pairAddress} ${token.chain}`.toLowerCase();
}

export function filterTokens(tokens: OverviewToken[], filters: OverviewFilters, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  const marketCapMin = parseFilterNumber(filters.marketCapMin);
  const marketCapMax = parseFilterNumber(filters.marketCapMax);
  const liquidityMin = parseFilterNumber(filters.liquidityMin);
  const liquidityMax = parseFilterNumber(filters.liquidityMax);
  const changeMin = parseFilterNumber(filters.changeMin);
  const changeMax = parseFilterNumber(filters.changeMax);
  const volumeMin = parseFilterNumber(filters.volumeMin);
  const volumeMax = parseFilterNumber(filters.volumeMax);

  return tokens.filter((token) => {
    if (query && !tokenSearchText(token).includes(query)) return false;
    if (filters.chain !== 'all' && token.chain !== filters.chain) return false;
    if (filters.event !== 'all' && token.event !== filters.event) return false;
    if (marketCapMin !== null && Number(token.marketCapUsd || 0) < marketCapMin) return false;
    if (marketCapMax !== null && Number(token.marketCapUsd || 0) > marketCapMax) return false;
    if (liquidityMin !== null && token.liquidityUsd < liquidityMin) return false;
    if (liquidityMax !== null && token.liquidityUsd > liquidityMax) return false;
    if (changeMin !== null && Number(token.change24h || 0) < changeMin) return false;
    if (changeMax !== null && Number(token.change24h || 0) > changeMax) return false;
    if (volumeMin !== null && token.volume24hUsd < volumeMin) return false;
    if (volumeMax !== null && token.volume24hUsd > volumeMax) return false;
    return true;
  });
}

export function sortTokens(tokens: OverviewToken[], sortConfig: SortConfig) {
  if (!sortConfig) return tokens;
  const multiplier = sortConfig.direction === 'asc' ? 1 : -1;

  return [...tokens].sort((left, right) => {
    const leftValue = left[sortConfig.key];
    const rightValue = right[sortConfig.key];
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      return String(leftValue || '').localeCompare(String(rightValue || '')) * multiplier;
    }
    return (Number(leftValue || 0) - Number(rightValue || 0)) * multiplier;
  });
}

export function visibleLimit(filters: OverviewFilters, total: number) {
  if (filters.visibleCount === 'all') return total;
  const limit = Number(filters.visibleCount);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, total) : total;
}

export function openToken(token: OverviewToken) {
  const params = new URLSearchParams({ chain: token.chain });
  if (token.pairAddress) params.set('pair', token.pairAddress);
  window.location.href = `/token/${encodeURIComponent(token.address)}?${params.toString()}`;
}

export function activeFilterCount(filters: OverviewFilters) {
  return Object.entries(filters).filter(([key, value]) => value !== DEFAULT_OVERVIEW_FILTERS[key as keyof OverviewFilters] && value !== '').length;
}
