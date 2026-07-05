import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WatchlistStore, type WatchlistAssetRow } from './store';

const originalEnv = { ...process.env };

function makeAsset(overrides: Partial<WatchlistAssetRow> = {}): WatchlistAssetRow {
  const now = new Date('2026-07-05T12:00:00.000Z').toISOString();
  return {
    id: 'asset-1',
    user_id: 'user-1',
    asset_type: 'token',
    chain_id: 'solana',
    token_address: 'TokenAddress',
    pair_address: null,
    coin_id: null,
    symbol: 'TOK',
    name: 'Token',
    image_url: null,
    price_usd: null,
    price_change_24h: null,
    liquidity_usd: null,
    risk_level: null,
    state: null,
    last_event_type: null,
    last_event_at: null,
    monitor_settings: {
      detectionEvents: true,
      safeScanChanges: false,
      liquidityChanges: false,
      riskChanges: true,
      aiStateChanges: true,
      majorVolumeEvents: true
    },
    last_snapshot: {},
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

describe('WatchlistStore.deleteAsset', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('throws when Supabase deletes no matching asset', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 })
    );

    await expect(new WatchlistStore().deleteAsset('asset-1', 'user-1')).rejects.toThrow('Watchlist asset was not found.');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('watchlist_assets?'),
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Prefer: 'return=representation' })
      })
    );
  });

  it('resolves when Supabase returns the deleted asset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([makeAsset()]), { status: 200 })
    );

    await expect(new WatchlistStore().deleteAsset('asset-1', 'user-1')).resolves.toBeUndefined();
  });
});
