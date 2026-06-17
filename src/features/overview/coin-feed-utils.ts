import type { CoinGeckoCoin } from '../../shared/coingecko';
import { parseFilterNumber, type OverviewFilters } from './overview-utils';

export type CoinSortKey =
  | 'marketCapRank'
  | 'symbol'
  | 'priceUsd'
  | 'change1h'
  | 'change24h'
  | 'change7d'
  | 'change30d'
  | 'marketCapUsd'
  | 'volume24hUsd'
  | 'fdvUsd'
  | 'circulatingSupply'
  | 'event';

export type CoinSortConfig = {
  key: CoinSortKey;
  direction: 'asc' | 'desc';
} | null;

export function coinSearchText(coin: CoinGeckoCoin) {
  return `${coin.symbol} ${coin.name} ${coin.id} ${coin.event}`.toLowerCase();
}

export function filterCoins(coins: CoinGeckoCoin[], filters: OverviewFilters, searchQuery: string) {
  const query = searchQuery.trim().toLowerCase();
  const marketCapMin = parseFilterNumber(filters.marketCapMin);
  const marketCapMax = parseFilterNumber(filters.marketCapMax);
  const changeMin = parseFilterNumber(filters.changeMin);
  const changeMax = parseFilterNumber(filters.changeMax);
  const volumeMin = parseFilterNumber(filters.volumeMin);
  const volumeMax = parseFilterNumber(filters.volumeMax);

  return coins.filter((coin) => {
    if (query && !coinSearchText(coin).includes(query)) return false;
    if (filters.event !== 'all' && coin.event !== filters.event) return false;
    if (marketCapMin !== null && Number(coin.marketCapUsd || 0) < marketCapMin) return false;
    if (marketCapMax !== null && Number(coin.marketCapUsd || 0) > marketCapMax) return false;
    if (changeMin !== null && Number(coin.change24h || 0) < changeMin) return false;
    if (changeMax !== null && Number(coin.change24h || 0) > changeMax) return false;
    if (volumeMin !== null && Number(coin.volume24hUsd || 0) < volumeMin) return false;
    if (volumeMax !== null && Number(coin.volume24hUsd || 0) > volumeMax) return false;
    return true;
  });
}

export function sortCoins(coins: CoinGeckoCoin[], sortConfig: CoinSortConfig) {
  if (!sortConfig) return coins;
  const multiplier = sortConfig.direction === 'asc' ? 1 : -1;
  return [...coins].sort((left, right) => {
    const leftValue = left[sortConfig.key];
    const rightValue = right[sortConfig.key];
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      return String(leftValue || '').localeCompare(String(rightValue || '')) * multiplier;
    }
    return (Number(leftValue || 0) - Number(rightValue || 0)) * multiplier;
  });
}

export function openCoin(coin: CoinGeckoCoin) {
  window.location.href = `/coin/${encodeURIComponent(coin.id)}`;
}
