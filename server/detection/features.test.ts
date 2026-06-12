import { describe, expect, it } from 'vitest';
import { calculateFeatures, getLiquidityShockThreshold, isMeaningfulLiquidityShock } from './features';
import type { TokenSnapshot } from './types';

describe('detection feature calculation', () => {
  it('handles the first snapshot without previous liquidity history', () => {
    const features = calculateFeatures(makeSnapshot(), []);

    expect(features.liquidityChangePercentage).toBeNull();
    expect(features.liquidityChangeUsd).toBeNull();
    expect(features.volumeSpikeScore).toBe(1);
  });

  it('uses pool-size-aware liquidity shock thresholds', () => {
    expect(getLiquidityShockThreshold(150_000)).toEqual({ percent: 15, usd: 10_000 });
    expect(isMeaningfulLiquidityShock(150_000, -18, -20_000)).toBe(true);
    expect(isMeaningfulLiquidityShock(75, -25, -25)).toBe(false);
  });
});

function makeSnapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    tokenId: 'base:test',
    timestamp: new Date().toISOString(),
    priceUsd: 1,
    marketCap: 1_000_000,
    liquidityUsd: 250_000,
    volume5m: 5_000,
    volume1h: 25_000,
    volume6h: 80_000,
    volume24h: 300_000,
    buys5m: 24,
    sells5m: 20,
    traders5m: 44,
    priceChange5m: 2,
    priceChange1h: 4,
    priceChange6h: 8,
    priceChange24h: 12,
    raw: {},
    ...overrides
  };
}
