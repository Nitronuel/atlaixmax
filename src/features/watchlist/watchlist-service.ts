import { apiUrl } from '../../config';
import type { CoinGeckoCoin } from '../../shared/coingecko';
import { authSupabase } from '../../services/SupabaseClient';
import type {
  WatchlistActivityItem,
  WatchlistAsset,
  WatchlistAssetInput,
  WatchlistMonitorSettings,
  WatchlistSummary
} from './watchlist-types';

const DEFAULT_MONITORS: WatchlistMonitorSettings = {
  detectionEvents: true,
  safeScanChanges: false,
  liquidityChanges: false,
  riskChanges: true,
  aiStateChanges: true,
  majorVolumeEvents: true
};

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMonitors(value: unknown): WatchlistMonitorSettings {
  const source = value && typeof value === 'object' ? value as Partial<WatchlistMonitorSettings> : {};
  return {
    detectionEvents: source.detectionEvents ?? true,
    safeScanChanges: source.safeScanChanges ?? false,
    liquidityChanges: source.liquidityChanges ?? false,
    riskChanges: source.riskChanges ?? true,
    aiStateChanges: source.aiStateChanges ?? true,
    majorVolumeEvents: source.majorVolumeEvents ?? true
  };
}

function normalizeAsset(row: any): WatchlistAsset {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || row.userId || ''),
    assetType: row.asset_type === 'coin' || row.assetType === 'coin' ? 'coin' : 'token',
    chainId: row.chain_id || row.chainId || null,
    tokenAddress: row.token_address || row.tokenAddress || null,
    pairAddress: row.pair_address || row.pairAddress || null,
    coinId: row.coin_id || row.coinId || null,
    symbol: String(row.symbol || ''),
    name: String(row.name || row.symbol || ''),
    imageUrl: row.image_url || row.imageUrl || null,
    priceUsd: normalizeNumber(row.price_usd ?? row.priceUsd),
    priceChange24h: normalizeNumber(row.price_change_24h ?? row.priceChange24h),
    liquidityUsd: normalizeNumber(row.liquidity_usd ?? row.liquidityUsd),
    riskLevel: row.risk_level || row.riskLevel || null,
    state: row.state || null,
    lastEventType: row.last_event_type || row.lastEventType || null,
    lastEventAt: row.last_event_at || row.lastEventAt || null,
    monitorSettings: normalizeMonitors(row.monitor_settings || row.monitorSettings),
    lastSnapshot: row.last_snapshot && typeof row.last_snapshot === 'object' ? row.last_snapshot : row.lastSnapshot || {},
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt || new Date().toISOString()
  };
}

function normalizeActivity(row: any): WatchlistActivityItem {
  return {
    id: String(row.id || ''),
    assetId: row.assetId || null,
    assetSymbol: String(row.assetSymbol || ''),
    assetName: String(row.assetName || ''),
    assetType: row.assetType === 'coin' ? 'coin' : 'token',
    title: String(row.title || ''),
    detail: String(row.detail || ''),
    tone: ['bullish', 'bearish', 'risk'].includes(row.tone) ? row.tone : 'neutral',
    source: row.source === 'smart-alert' || row.source === 'watchlist' ? row.source : 'detection',
    createdAt: row.createdAt || new Date().toISOString(),
    href: row.href || null
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = authSupabase ? await authSupabase.auth.getSession() : { data: { session: null } };
  const accessToken = data.session?.access_token;
  const response = await fetch(apiUrl(path), {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Watchlist request failed.');
  }
  return payload as T;
}

export const WatchlistService = {
  defaultMonitors: DEFAULT_MONITORS,

  async listAssets() {
    const payload = await requestJson<{ assets: unknown[] }>('/api/watchlist/assets');
    return (payload.assets || []).map(normalizeAsset);
  },

  async createAsset(input: WatchlistAssetInput) {
    const payload = await requestJson<{ asset: unknown }>('/api/watchlist/assets', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return normalizeAsset(payload.asset);
  },

  async updateAsset(id: string, patch: Partial<WatchlistAssetInput>) {
    const payload = await requestJson<{ asset: unknown }>(`/api/watchlist/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    return normalizeAsset(payload.asset);
  },

  async refreshAsset(id: string) {
    const payload = await requestJson<{ asset: unknown }>(`/api/watchlist/assets/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    return normalizeAsset(payload.asset);
  },

  async deleteAsset(id: string) {
    await requestJson(`/api/watchlist/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async getSummary() {
    const payload = await requestJson<WatchlistSummary>('/api/watchlist/summary');
    return {
      ...payload,
      activity: (payload.activity || []).map(normalizeActivity)
    };
  },

  async getActivity(limit = 30) {
    const params = new URLSearchParams({ limit: String(limit) });
    const payload = await requestJson<{ activity: unknown[] }>(`/api/watchlist/activity?${params.toString()}`);
    return (payload.activity || []).map(normalizeActivity);
  },

  async searchCoins(query: string) {
    if (!query.trim()) return [];
    const params = new URLSearchParams({ q: query.trim() });
    const payload = await requestJson<{ coins: CoinGeckoCoin[] }>(`/api/coingecko/search?${params.toString()}`);
    return payload.coins || [];
  },

  async lookupToken(address: string, chainId: string) {
    const params = new URLSearchParams({ address: address.trim(), chain: chainId.trim().toLowerCase() });
    return requestJson<{ token: {
      address: string;
      pairAddress: string | null;
      chainId: string;
      name: string;
      symbol: string;
      priceUsd: number | null;
      change24h: number | null;
      liquidityUsd: number | null;
      riskLevel: string | null;
      imageUrl?: string | null;
    } }>(`/api/smart-alerts/token-lookup?${params.toString()}`);
  }
};
