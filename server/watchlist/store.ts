import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readEnv } from '../env';

export type WatchlistAssetType = 'token' | 'coin';

export type WatchlistMonitorSettings = {
  detectionEvents: boolean;
  safeScanChanges: boolean;
  liquidityChanges: boolean;
  riskChanges: boolean;
  aiStateChanges: boolean;
  majorVolumeEvents: boolean;
};

export type WatchlistAssetRow = {
  id: string;
  user_id: string;
  asset_type: WatchlistAssetType;
  chain_id: string | null;
  token_address: string | null;
  pair_address: string | null;
  coin_id: string | null;
  symbol: string;
  name: string;
  image_url: string | null;
  price_usd: number | null;
  price_change_24h: number | null;
  liquidity_usd: number | null;
  risk_level: string | null;
  state: string | null;
  last_event_type: string | null;
  last_event_at: string | null;
  monitor_settings: WatchlistMonitorSettings;
  last_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WatchlistAssetInput = {
  assetType: WatchlistAssetType;
  chainId?: string | null;
  tokenAddress?: string | null;
  pairAddress?: string | null;
  coinId?: string | null;
  symbol?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  priceUsd?: number | null;
  priceChange24h?: number | null;
  liquidityUsd?: number | null;
  riskLevel?: string | null;
  state?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  monitorSettings?: Partial<WatchlistMonitorSettings> | null;
  lastSnapshot?: Record<string, unknown> | null;
};

type LocalWatchlistState = {
  assets: WatchlistAssetRow[];
};

const SUPABASE_TIMEOUT_MS = 12_000;
const ASSET_COLUMNS = [
  'id',
  'user_id',
  'asset_type',
  'chain_id',
  'token_address',
  'pair_address',
  'coin_id',
  'symbol',
  'name',
  'image_url',
  'price_usd',
  'price_change_24h',
  'liquidity_usd',
  'risk_level',
  'state',
  'last_event_type',
  'last_event_at',
  'monitor_settings',
  'last_snapshot',
  'created_at',
  'updated_at'
].join(',');

export const DEFAULT_MONITOR_SETTINGS: WatchlistMonitorSettings = {
  detectionEvents: true,
  safeScanChanges: false,
  liquidityChanges: false,
  riskChanges: true,
  aiStateChanges: true,
  majorVolumeEvents: true
};

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function getLocalPath() {
  return resolve(process.cwd(), '.data', 'watchlist-assets.json');
}

function readLocalState(): LocalWatchlistState {
  const filepath = getLocalPath();
  if (!existsSync(filepath)) return { assets: [] };
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf8')) as LocalWatchlistState;
    return { assets: Array.isArray(parsed.assets) ? parsed.assets.map(normalizeAssetRow) : [] };
  } catch {
    return { assets: [] };
  }
}

function writeLocalState(state: LocalWatchlistState) {
  const filepath = getLocalPath();
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(state, null, 2));
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for Watchlist.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Supabase Watchlist request failed (${response.status}). ${message}`.trim());
    }

    if (response.status === 204) return null as T;
    return response.json().catch(() => null) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeMonitorSettings(value: unknown): WatchlistMonitorSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    detectionEvents: source.detectionEvents === undefined ? true : Boolean(source.detectionEvents),
    safeScanChanges: source.safeScanChanges === undefined ? false : Boolean(source.safeScanChanges),
    liquidityChanges: source.liquidityChanges === undefined ? false : Boolean(source.liquidityChanges),
    riskChanges: source.riskChanges === undefined ? true : Boolean(source.riskChanges),
    aiStateChanges: source.aiStateChanges === undefined ? true : Boolean(source.aiStateChanges),
    majorVolumeEvents: source.majorVolumeEvents === undefined ? true : Boolean(source.majorVolumeEvents)
  };
}

function normalizeAssetType(value: unknown): WatchlistAssetType {
  return value === 'coin' ? 'coin' : 'token';
}

function normalizeAssetRow(row: any): WatchlistAssetRow {
  const now = new Date().toISOString();
  return {
    id: String(row.id || randomUUID()),
    user_id: String(row.user_id || ''),
    asset_type: normalizeAssetType(row.asset_type || row.assetType),
    chain_id: row.chain_id || row.chainId || null,
    token_address: row.token_address || row.tokenAddress || null,
    pair_address: row.pair_address || row.pairAddress || null,
    coin_id: row.coin_id || row.coinId || null,
    symbol: String(row.symbol || '').trim(),
    name: String(row.name || row.symbol || '').trim(),
    image_url: row.image_url || row.imageUrl || null,
    price_usd: toNumber(row.price_usd ?? row.priceUsd),
    price_change_24h: toNumber(row.price_change_24h ?? row.priceChange24h),
    liquidity_usd: toNumber(row.liquidity_usd ?? row.liquidityUsd),
    risk_level: row.risk_level || row.riskLevel || null,
    state: row.state || null,
    last_event_type: row.last_event_type || row.lastEventType || null,
    last_event_at: row.last_event_at || row.lastEventAt || null,
    monitor_settings: normalizeMonitorSettings(row.monitor_settings || row.monitorSettings),
    last_snapshot: row.last_snapshot && typeof row.last_snapshot === 'object' ? row.last_snapshot : row.lastSnapshot || {},
    created_at: row.created_at || now,
    updated_at: row.updated_at || now
  };
}

function inputToRow(input: WatchlistAssetInput, userId: string, id = randomUUID()): WatchlistAssetRow {
  const now = new Date().toISOString();
  const assetType = normalizeAssetType(input.assetType);
  const chainId = input.chainId?.trim().toLowerCase() || null;
  const tokenAddress = input.tokenAddress?.trim() || null;
  const coinId = input.coinId?.trim().toLowerCase() || null;

  if (assetType === 'token' && (!chainId || !tokenAddress)) {
    throw new Error('Token chain and address are required.');
  }

  if (assetType === 'coin' && !coinId) {
    throw new Error('Coin id is required.');
  }

  return normalizeAssetRow({
    id,
    user_id: userId,
    asset_type: assetType,
    chain_id: assetType === 'token' ? chainId : null,
    token_address: assetType === 'token' ? tokenAddress : null,
    pair_address: assetType === 'token' ? input.pairAddress?.trim() || null : null,
    coin_id: assetType === 'coin' ? coinId : null,
    symbol: input.symbol?.trim() || (assetType === 'token' ? String(tokenAddress).slice(0, 6) : String(coinId)),
    name: input.name?.trim() || input.symbol?.trim() || (assetType === 'token' ? String(tokenAddress) : String(coinId)),
    image_url: input.imageUrl || null,
    price_usd: input.priceUsd ?? null,
    price_change_24h: input.priceChange24h ?? null,
    liquidity_usd: input.liquidityUsd ?? null,
    risk_level: input.riskLevel || null,
    state: input.state || null,
    last_event_type: input.lastEventType || null,
    last_event_at: input.lastEventAt || null,
    monitor_settings: normalizeMonitorSettings(input.monitorSettings),
    last_snapshot: input.lastSnapshot || {},
    created_at: now,
    updated_at: now
  });
}

function sameIdentity(left: WatchlistAssetRow, right: WatchlistAssetRow) {
  if (left.user_id !== right.user_id || left.asset_type !== right.asset_type) return false;
  if (left.asset_type === 'coin') return left.coin_id?.toLowerCase() === right.coin_id?.toLowerCase();
  return (
    left.chain_id?.toLowerCase() === right.chain_id?.toLowerCase() &&
    left.token_address?.toLowerCase() === right.token_address?.toLowerCase()
  );
}

function rowToSupabasePayload(row: WatchlistAssetRow) {
  return row;
}

export class WatchlistStore {
  private useLocalOnly = false;

  async listAssets(userId: string) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: ASSET_COLUMNS,
          user_id: `eq.${userId}`,
          order: 'created_at.desc'
        });
        const rows = await supabaseFetch<any[]>(`watchlist_assets?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(normalizeAssetRow) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().assets
      .filter((asset) => asset.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async createAsset(input: WatchlistAssetInput, userId: string) {
    const row = inputToRow(input, userId);
    const existing = (await this.listAssets(userId)).find((asset) => sameIdentity(asset, row));
    if (existing) return existing;

    if (!this.useLocalOnly) {
      try {
        const rows = await supabaseFetch<any[]>(`watchlist_assets?select=${encodeURIComponent(ASSET_COLUMNS)}`, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(rowToSupabasePayload(row))
        });
        return normalizeAssetRow(Array.isArray(rows) ? rows[0] : rows);
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.assets.unshift(row);
    writeLocalState(state);
    return row;
  }

  async updateAsset(id: string, patch: Partial<WatchlistAssetInput>, userId: string) {
    const normalizedPatch: Record<string, unknown> = {};
    if (patch.symbol !== undefined) normalizedPatch.symbol = patch.symbol;
    if (patch.name !== undefined) normalizedPatch.name = patch.name;
    if (patch.imageUrl !== undefined) normalizedPatch.image_url = patch.imageUrl;
    if (patch.priceUsd !== undefined) normalizedPatch.price_usd = patch.priceUsd;
    if (patch.priceChange24h !== undefined) normalizedPatch.price_change_24h = patch.priceChange24h;
    if (patch.liquidityUsd !== undefined) normalizedPatch.liquidity_usd = patch.liquidityUsd;
    if (patch.riskLevel !== undefined) normalizedPatch.risk_level = patch.riskLevel;
    if (patch.state !== undefined) normalizedPatch.state = patch.state;
    if (patch.lastEventType !== undefined) normalizedPatch.last_event_type = patch.lastEventType;
    if (patch.lastEventAt !== undefined) normalizedPatch.last_event_at = patch.lastEventAt;
    if (patch.monitorSettings !== undefined) normalizedPatch.monitor_settings = normalizeMonitorSettings(patch.monitorSettings);
    if (patch.lastSnapshot !== undefined) normalizedPatch.last_snapshot = patch.lastSnapshot || {};
    normalizedPatch.updated_at = new Date().toISOString();

    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          id: `eq.${id}`,
          user_id: `eq.${userId}`,
          select: ASSET_COLUMNS
        });
        const rows = await supabaseFetch<any[]>(`watchlist_assets?${params.toString()}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(normalizedPatch)
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) throw new Error('Watchlist asset was not found.');
        return normalizeAssetRow(row);
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const index = state.assets.findIndex((asset) => asset.id === id && asset.user_id === userId);
    if (index < 0) throw new Error('Watchlist asset was not found.');
    state.assets[index] = normalizeAssetRow({ ...state.assets[index], ...normalizedPatch });
    writeLocalState(state);
    return state.assets[index];
  }

  async deleteAsset(id: string, userId: string) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({ id: `eq.${id}`, user_id: `eq.${userId}` });
        await supabaseFetch<null>(`watchlist_assets?${params.toString()}`, { method: 'DELETE' });
        return;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.assets = state.assets.filter((asset) => asset.id !== id || asset.user_id !== userId);
    writeLocalState(state);
  }
}
