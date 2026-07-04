import { describe, expect, it } from 'vitest';
import type { OverviewToken } from '../../src/shared/overview';
import { resolveScanSchedule, selectDetectionBatch } from './runner';
import type { FinalClassification } from './types';

describe('detection runner queueing', () => {
  it('prioritizes due queue tokens before future scheduled candidates', () => {
    const now = Date.parse('2026-06-12T12:00:00.000Z');
    const tokens = [
      makeOverviewToken({ id: 'future', address: 'FutureAddress', pairAddress: 'FuturePair', volume24hUsd: 5_000_000 }),
      makeOverviewToken({ id: 'hot', address: 'HotAddress', pairAddress: 'HotPair' }),
      makeOverviewToken({ id: 'cold', address: 'ColdAddress', pairAddress: 'ColdPair' })
    ];
    const states = new Map([
      ['solana:futureaddress', { scanTier: 'hot' as const, nextDetectionCheckAt: new Date(now + 60_000).toISOString(), detectionPriorityScore: 500 }],
      ['solana:hotaddress', { scanTier: 'hot' as const, nextDetectionCheckAt: new Date(now - 60_000).toISOString(), detectionPriorityScore: 20 }],
      ['solana:coldaddress', { scanTier: 'cold' as const, nextDetectionCheckAt: new Date(now - 60_000).toISOString(), detectionPriorityScore: 5 }]
    ]);

    expect(selectDetectionBatch(tokens, states, 2, 0, now).map((token) => token.id)).toEqual(['hot', 'cold']);
  });

  it('schedules critical events as hot and quiet labels as dormant', () => {
    const now = Date.parse('2026-06-12T12:00:00.000Z');
    const hot = resolveScanSchedule(makeClassification(), null, true, now);
    const dormant = resolveScanSchedule(makeClassification({
      primaryLabel: 'LOW_ACTIVITY',
      riskLevel: 'low',
      alertPriority: 'none',
      dataQuality: { ...makeClassification().dataQuality, hasMinimumActivity: false }
    }), null, false, now);

    expect(hot.scanTier).toBe('hot');
    expect(Date.parse(hot.nextDetectionCheckAt) - now).toBe(120_000);
    expect(dormant.scanTier).toBe('dormant');
  });
});

function makeOverviewToken(overrides: Partial<OverviewToken> = {}): OverviewToken {
  return {
    id: 'token',
    chain: 'solana',
    dex: 'pumpswap',
    name: 'Token',
    symbol: 'TOK',
    address: 'TokenAddress',
    pairAddress: 'PairAddress',
    url: 'https://dexscreener.com/solana/PairAddress',
    priceUsd: 0.01,
    change24h: 0,
    marketCapUsd: 100_000,
    volume24hUsd: 100_000,
    liquidityUsd: 50_000,
    dexBuys24h: 100,
    dexSells24h: 90,
    dexFlow24h: 10,
    dexFlowUsd24h: 1_000,
    event: 'Market Watch',
    pairCreatedAt: null,
    marketDataUpdatedAt: '2026-06-12T12:00:00.000Z',
    ...overrides
  };
}

function makeClassification(overrides: Partial<FinalClassification> = {}): FinalClassification {
  return {
    primaryLabel: 'LIQUIDITY_DRAIN',
    riskLevel: 'critical',
    alertPriority: 'critical',
    finalConfidence: 86,
    risk: { level: 'critical', score: 90, reasons: ['Liquidity shock'] },
    volumeQuality: { score: 70, level: 'good' },
    eventStatus: 'new',
    dataQuality: {
      score: 80,
      historySnapshots: 4,
      missingFields: [],
      warnings: [],
      hasMinimumActivity: true,
      hasEnoughHistory: true,
      hasReliableLiquidity: true
    },
    ...overrides
  } as FinalClassification;
}
