import type { LabelResponse, ScannerResponse, WalletEntry } from '../../shared/insightx';
import { normalizePercentValue } from './format';

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
  return Number(row?.balance ?? row?.amount ?? row?.token_balance);
}

export function supplyPercentField(entry: unknown) {
  const row = entry as Record<string, unknown>;
  return row?.percentage ?? row?.pct ?? row?.supply_pct ?? row?.total_pct;
}

export function clusterMembers(cluster: unknown): WalletEntry[] {
  const row = cluster as Record<string, unknown>;
  if (Array.isArray(row?.members)) return row.members as WalletEntry[];
  if (Array.isArray(row?.wallets)) return row.wallets as WalletEntry[];
  if (Array.isArray(row?.cluster_addresses)) return row.cluster_addresses as WalletEntry[];
  if (Array.isArray(row?.addresses)) return row.addresses as WalletEntry[];
  if (Array.isArray(row?.holders)) return row.holders as WalletEntry[];
  return [];
}

export function clusterList(data: unknown): unknown[] {
  const payload = data as Record<string, unknown>;
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.clusters)) return payload.clusters;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

export function labelMap(labels: LabelResponse[] | null) {
  const map = new Map<string, LabelResponse>();
  for (const label of labels || []) {
    if (label.address) map.set(label.address.toLowerCase(), label);
  }
  return map;
}

export function collectLabels(data: unknown): LabelResponse[] {
  if (Array.isArray(data)) return data as LabelResponse[];
  const payload = data as Record<string, unknown>;
  if (Array.isArray(payload?.labels)) return payload.labels as LabelResponse[];
  if (Array.isArray(payload?.data)) return payload.data as LabelResponse[];
  if (Array.isArray(payload?.items)) return payload.items as LabelResponse[];
  return [];
}

export function enrichWalletRows(rows: WalletEntry[] = [], labels: Map<string, LabelResponse>) {
  const unique = new Map<string, WalletEntry>();
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
        label: label?.label || row.label,
        tags: label?.tags || row.tags,
        smart_contract: label?.smart_contract ?? row.smart_contract
      });
    }
  }
  return [...unique.values()];
}

export function creatorSupplyShare(scanner: ScannerResponse | null, fallback?: unknown) {
  const advanced = scanner?.results?.advanced as Record<string, unknown> | undefined;
  const creator = advanced?.creator as Record<string, unknown> | undefined;
  const creatorBalance = Number(creator?.balance);
  const totalSupply = Number(scanner?.token?.total_supply);
  if (Number.isFinite(creatorBalance) && creatorBalance >= 0 && Number.isFinite(totalSupply) && totalSupply > 0) {
    return (creatorBalance / totalSupply) * 100;
  }
  return normalizePercentValue(fallback);
}

export function clusterSupplyBalance(clusters: unknown, totalSupply?: number | null, fallback?: unknown) {
  const seen = new Set<string>();
  const total = clusterList(clusters).reduce<number>((sum, cluster) => {
    const members = clusterMembers(cluster);
    const memberTotal = members.reduce<number>((memberSum, member) => {
      const address = walletAddress(member).toLowerCase();
      if (address && seen.has(address)) return memberSum;
      if (address) seen.add(address);
      const balance = walletBalance(member);
      return Number.isFinite(balance) && balance > 0 ? memberSum + balance : memberSum;
    }, 0);
    if (memberTotal > 0) return sum + memberTotal;
    const directBalance = walletBalance(cluster);
    return Number.isFinite(directBalance) && directBalance > 0 ? sum + directBalance : sum;
  }, 0);

  const fallbackPercent = normalizePercentValue(fallback);
  const supply = Number(totalSupply);
  if (Number.isFinite(supply) && supply > 0 && fallbackPercent !== null) {
    const fallbackBalance = (supply * fallbackPercent) / 100;
    return total > 0 ? Math.max(total, fallbackBalance) : fallbackBalance;
  }
  return total > 0 ? total : null;
}

export function inferSupplyFromClusters(clusters: unknown) {
  const candidates: number[] = [];
  for (const cluster of clusterList(clusters)) {
    for (const source of [cluster, ...clusterMembers(cluster)]) {
      const balance = walletBalance(source);
      const percent = normalizePercentValue(supplyPercentField(source));
      if (Number.isFinite(balance) && balance > 0 && percent && percent > 0) {
        const inferred = balance / (percent / 100);
        if (Number.isFinite(inferred) && inferred >= balance) candidates.push(inferred);
      }
    }
  }
  if (!candidates.length) return null;
  const sorted = candidates.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
