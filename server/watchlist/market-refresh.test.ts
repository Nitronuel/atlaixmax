import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoinGeckoCoin } from '../coingecko/database';
import { lookupSmartAlertToken } from '../smart-alerts/runner';
import { refreshWatchlistAssetMarketData } from './market-refresh';
import type { WatchlistAssetRow, WatchlistStore } from './store';

vi.mock('../coingecko/database', () => ({
  getCoinGeckoCoin: vi.fn()
}));

vi.mock('../smart-alerts/runner', () => ({
  lookupSmartAlertToken: vi.fn()
}));

function makeAsset(overrides: Partial<WatchlistAssetRow> = {}): WatchlistAssetRow {
  const now = new Date('2026-07-03T09:00:00.000Z').toISOString();
  return {
    id: 'asset-1',
    user_id: 'user-1',
    asset_type: 'token',
    chain_id: 'solana',
    token_address: 'TokenAddress',
    pair_address: 'PairAddress',
    coin_id: null,
    symbol: 'OLD',
    name: 'Old token',
    image_url: null,
    price_usd: 1,
    price_change_24h: 0,
    liquidity_usd: 100,
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

function makeStore() {
  return {
    updateAsset: vi.fn(async (_id: string, patch: unknown) => ({ patch }))
  } as unknown as WatchlistStore & { updateAsset: ReturnType<typeof vi.fn> };
}

describe('refreshWatchlistAssetMarketData', () => {
  beforeEach(() => {
    vi.mocked(getCoinGeckoCoin).mockReset();
    vi.mocked(lookupSmartAlertToken).mockReset();
  });

  it('refreshes stale token market fields from DexScreener lookup', async () => {
    const asset = makeAsset();
    const store = makeStore();
    vi.mocked(lookupSmartAlertToken).mockResolvedValue({
      address: 'TokenAddress',
      pairAddress: 'PairAddress',
      chainId: 'solana',
      name: 'Jupiter',
      symbol: 'JUP',
      priceUsd: 0.24,
      change24h: 4.6,
      volume24h: 1_500_000,
      liquidityUsd: 1_000_000,
      riskLevel: null,
      imageUrl: 'https://example.com/jup.png',
      source: 'dexscreener'
    });

    await refreshWatchlistAssetMarketData(store, asset, 'user-1');

    expect(lookupSmartAlertToken).toHaveBeenCalledWith('TokenAddress', 'solana', 'PairAddress');
    expect(store.updateAsset).toHaveBeenCalledWith('asset-1', expect.objectContaining({
      symbol: 'JUP',
      name: 'Jupiter',
      priceUsd: 0.24,
      priceChange24h: 4.6,
      liquidityUsd: 1_000_000,
      lastSnapshot: expect.objectContaining({
        marketSource: 'dexscreener',
        volume24hUsd: 1_500_000
      })
    }), 'user-1');
  });

  it('skips fresh assets unless refresh is forced', async () => {
    const asset = makeAsset({
      last_snapshot: {
        marketRefreshedAt: new Date().toISOString()
      }
    });
    const store = makeStore();

    const result = await refreshWatchlistAssetMarketData(store, asset, 'user-1');

    expect(result).toBe(asset);
    expect(lookupSmartAlertToken).not.toHaveBeenCalled();
    expect(store.updateAsset).not.toHaveBeenCalled();
  });

  it('refreshes coin market fields from CoinGecko', async () => {
    const asset = makeAsset({
      asset_type: 'coin',
      chain_id: null,
      token_address: null,
      pair_address: null,
      coin_id: 'jupiter-exchange-solana',
      symbol: 'JUP',
      name: 'Jupiter',
      liquidity_usd: null
    });
    const store = makeStore();
    vi.mocked(getCoinGeckoCoin).mockResolvedValue({
      generatedAt: new Date().toISOString(),
      coin: {
        id: 'jupiter-exchange-solana',
        symbol: 'JUP',
        name: 'Jupiter',
        image: 'https://example.com/jup.png',
        marketCapRank: 79,
        priceUsd: 0.241,
        marketCapUsd: 802_000_000,
        fdvUsd: 1_650_000_000,
        volume24hUsd: 45_000_000,
        change1h: 0,
        change24h: 4.3,
        change7d: 5.7,
        change30d: 18.9,
        circulatingSupply: 3_320_000_000,
        totalSupply: 6_860_000_000,
        maxSupply: 10_000_000_000,
        ath: 2,
        athChangePercentage: -87,
        atl: 0.13,
        atlChangePercentage: 78,
        sparkline7d: [],
        event: 'Market Watch',
        lastSeenAt: new Date().toISOString(),
        description: '',
        homepage: '',
        links: [],
        categories: []
      }
    });

    await refreshWatchlistAssetMarketData(store, asset, 'user-1');

    expect(getCoinGeckoCoin).toHaveBeenCalledWith('jupiter-exchange-solana');
    expect(store.updateAsset).toHaveBeenCalledWith('asset-1', expect.objectContaining({
      coinId: 'jupiter-exchange-solana',
      priceUsd: 0.241,
      priceChange24h: 4.3,
      state: 'Market Watch',
      lastSnapshot: expect.objectContaining({
        marketSource: 'coingecko',
        marketCapUsd: 802_000_000,
        volume24hUsd: 45_000_000
      })
    }), 'user-1');
  });
});
