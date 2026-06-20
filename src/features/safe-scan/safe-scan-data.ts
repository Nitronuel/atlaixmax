import type { AddressDetails, AddressMetadata, ClusterData, TokenHolder } from '../../shared/bubblemaps';

export function endpointData<T>(result?: { status: string; data: T | null }) {
  return result?.status === 'available' ? result.data : null;
}

export function walletAddress(entry: unknown) {
  if (typeof entry === 'string') return entry.trim();
  const row = entry as Record<string, unknown>;
  return String(row?.address ?? row?.wallet ?? row?.owner ?? row?.account ?? '').trim();
}

export function walletBalance(entry: unknown) {
  const row = entry as Record<string, unknown>;
  const holder = row?.holder_data as Record<string, unknown> | undefined;
  return Number(holder?.amount ?? row?.balance ?? row?.amount ?? row?.token_balance);
}

export function supplyPercentField(entry: unknown) {
  const row = entry as Record<string, unknown>;
  const holder = row?.holder_data as Record<string, unknown> | undefined;
  const value = holder?.share ?? row?.share ?? row?.percentage ?? row?.pct ?? row?.supply_pct ?? row?.total_pct;
  return typeof value === 'number' && value > 0 && value <= 1 ? value * 100 : value;
}

function medianTotal(totals: number[]) {
  if (!totals.length) return null;
  return totals.sort((left, right) => left - right)[Math.floor(totals.length / 2)];
}

function shareToPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function holderImpliedTotal(holder: unknown) {
  const amount = walletBalance(holder);
  const row = holder as Record<string, unknown>;
  const holderData = row?.holder_data as Record<string, unknown> | undefined;
  const share = Number(holderData?.share ?? row?.share);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(share) || share <= 0) return null;
  return share <= 1 ? amount / share : amount / (share / 100);
}

function clusterImpliedTotal(cluster: ClusterData, shareScale: 'fraction' | 'percent') {
  const amount = Number(cluster.amount);
  const share = Number(cluster.share);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(share) || share <= 0) return null;
  return shareScale === 'fraction' ? amount / share : amount / (share / 100);
}

export function inferredTotalSupply(clusters: unknown, holders: unknown[] = []) {
  const holderTotals = holders
    .map(holderImpliedTotal)
    .filter((value): value is number => Boolean(value));
  const holderTotal = medianTotal(holderTotals);
  if (holderTotal) return holderTotal;

  const rows = clusterList(clusters);
  const percentTotals = rows
    .map((cluster) => clusterImpliedTotal(cluster, 'percent'))
    .filter((value): value is number => Boolean(value));
  const fractionTotals = rows
    .filter((cluster) => Number(cluster.share) > 0 && Number(cluster.share) <= 1)
    .map((cluster) => clusterImpliedTotal(cluster, 'fraction'))
    .filter((value): value is number => Boolean(value));
  return medianTotal(fractionTotals.length ? fractionTotals : percentTotals);
}

export function holderSupplyPercent(holder: unknown, totalSupply: number | null): number | null {
  const amount = walletBalance(holder);
  if (totalSupply && Number.isFinite(amount) && amount >= 0) {
    return (amount / totalSupply) * 100;
  }
  const fallback = supplyPercentField(holder);
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
}

export function clusterSupplyPercent(cluster: ClusterData, totalSupply: number | null) {
  const amount = Number(cluster.amount);
  if (totalSupply && Number.isFinite(amount) && amount >= 0 && Number(cluster.share) > 1) {
    return (amount / totalSupply) * 100;
  }
  return shareToPercent(cluster.share);
}

export function clusterMembers(cluster: unknown): TokenHolder[] {
  const row = cluster as Record<string, unknown>;
  if (Array.isArray(row?.members)) return row.members as TokenHolder[];
  if (Array.isArray(row?.wallets)) return row.wallets as TokenHolder[];
  if (Array.isArray(row?.cluster_addresses)) return row.cluster_addresses as TokenHolder[];
  if (Array.isArray(row?.addresses)) return row.addresses as TokenHolder[];
  if (Array.isArray(row?.holders)) {
    return row.holders.map((holder) => typeof holder === 'string' ? {
      address: holder,
      holder_data: { amount: 0, rank: 0, share: 0 }
    } : holder) as TokenHolder[];
  }
  return [];
}

export function clusterList(data: unknown): ClusterData[] {
  const payload = data as Record<string, unknown>;
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as ClusterData[];
  if (Array.isArray(payload.clusters)) return payload.clusters as ClusterData[];
  if (Array.isArray(payload.data)) return payload.data as ClusterData[];
  return [];
}

export function labelMap(rows: Array<TokenHolder | AddressMetadata> | null) {
  const map = new Map<string, AddressMetadata>();
  for (const row of rows || []) {
    const address = row.address?.toLowerCase();
    const addressDetails = 'address_details' in row ? row.address_details : null;
    if (address && addressDetails) map.set(address, { address: row.address, address_details: addressDetails as AddressDetails });
  }
  return map;
}

export function enrichWalletRows(rows: TokenHolder[] = [], labels: Map<string, AddressMetadata>) {
  const unique = new Map<string, TokenHolder>();
  for (const row of rows) {
    const address = walletAddress(row);
    if (!address) continue;
    const existing = unique.get(address.toLowerCase());
    const currentBalance = walletBalance(row);
    const existingBalance = existing ? walletBalance(existing) : Number.NaN;
    if (!existing || (Number.isFinite(currentBalance) && currentBalance > existingBalance)) {
      const label = labels.get(address.toLowerCase());
      unique.set(address.toLowerCase(), {
        ...existing,
        ...row,
        address,
        address_details: row.address_details || label?.address_details || null
      });
    }
  }
  return [...unique.values()];
}

export function clusterSupplyBalance(clusters: unknown) {
  const total = clusterList(clusters).reduce<number>((sum, cluster) => {
    const amount = Number(cluster.amount);
    return Number.isFinite(amount) && amount > 0 ? sum + amount : sum;
  }, 0);
  return total > 0 ? total : null;
}

export function largestCluster(clusters: unknown) {
  return clusterList(clusters).slice().sort((left, right) => right.share - left.share)[0] || null;
}
