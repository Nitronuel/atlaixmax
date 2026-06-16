import { describe, expect, it } from 'vitest';
import { toSetupRow } from './setupWriter';
import type { DetectionEvent } from '../../src/shared/detection';
import type { FinalClassification, TokenFeatures, TokenRecord } from '../detection/types';

describe('detection lab setup writer', () => {
  it('builds a compact setup row from the event classification context', () => {
    const row = toSetupRow({
      record: makeRecord(),
      features: makeFeatures(),
      classification: makeClassification(),
      event: makeEvent(),
      historySnapshots: 12
    });

    expect(row.event_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(row.token_id).toBe('solana:pair');
    expect(row.event_label).toBe('ACCUMULATION');
    expect(row.price_usd).toBe(0.01);
    expect(row.buy_txn_dominance).toBe(0.7);
    expect(row.history_snapshots).toBe(12);
    expect(row.context_summary.eventType).toBe('Accumulation');
  });
});

function makeRecord(): TokenRecord {
  return {
    token: {
      tokenId: 'solana:pair',
      tokenName: 'Token',
      tokenSymbol: 'TOK',
      tokenAddress: 'TokenAddress',
      chain: 'solana',
      pairAddress: 'PairAddress',
      dexId: 'pumpswap',
      pairUrl: null
    },
    snapshot: {
      tokenId: 'solana:pair',
      timestamp: '2026-06-16T12:00:00.000Z',
      priceUsd: 0.01,
      marketCap: 100_000,
      liquidityUsd: 25_000,
      volume5m: 1_500,
      volume1h: 10_000,
      volume6h: 50_000,
      volume24h: 100_000,
      buys5m: 14,
      sells5m: 6,
      traders5m: 20,
      priceChange5m: 2,
      priceChange1h: 6,
      priceChange6h: 12,
      priceChange24h: 18,
      pairCreatedAt: null,
      pairReliability: { score: 72, tier: 'high', reasons: [] },
      raw: {}
    }
  };
}

function makeFeatures(): TokenFeatures {
  return {
    tokenId: 'solana:pair',
    timestamp: '2026-06-16T12:00:00.000Z',
    totalTxns5m: 20,
    buySellRatio: 2.14,
    buyTxnDominance: 0.7,
    sellTxnDominance: 0.3,
    netTxnPressure: 0.4,
    liquidityChangePercentage: 5,
    liquidityChangeUsd: 1_000,
    volumeToLiquidityRatio: 0.06,
    volumeSpikeScore: 1.8,
    volumeSpikePersistedSnapshots: 2,
    volumeQualityScore: 70,
    volumeQualityLevel: 'good',
    liquidityRegime: 'HEALTHY_LIQUIDITY',
    priceMomentumScore: 8,
    volatilityScore: 10,
    consecutiveGreenSnapshots: 3,
    consecutiveRedSnapshots: 0,
    consecutiveBuyDominantSnapshots: 4,
    consecutiveSellDominantSnapshots: 0,
    trendDirection: 'uptrend',
    liquidityState: 'increasing',
    pressureState: 'strong_buy_pressure'
  };
}

function makeClassification(): FinalClassification {
  return {
    tokenId: 'solana:pair',
    timestamp: '2026-06-16T12:00:00.000Z',
    ruleLabel: 'ACCUMULATION',
    ruleConfidence: 74,
    finalLabel: 'ACCUMULATION',
    finalConfidence: 74,
    riskLevel: 'low',
    reason: 'Accumulation detected.',
    primaryLabel: 'ACCUMULATION',
    displayLabel: 'Accumulation',
    marketPhase: 'ACCUMULATION',
    structuralRegime: 'BULLISH',
    activeRegime: 'CONTINUATION',
    dominantTimeframe: '6h',
    dominantReason: '6h has the strongest direction score.',
    eventHorizon: '6h',
    confirmationStatus: 'confirmed',
    confirmationScore: 76,
    classificationBasis: 'higher_timeframe_confirmed',
    lowerTimeframeTrigger: '5M_BUY_TXN_DOMINANCE',
    timeframeAlignment: { status: 'aligned_bullish', score: 85, conflictSeverity: 'none' },
    trendChange: 'IMPROVING',
    eventStatus: 'new',
    confidence: {
      triggerConfidence: 70,
      regimeConfidence: 76,
      interpretationConfidence: 74,
      dataConfidence: 80,
      finalConfidence: 74
    },
    risk: { level: 'low', score: 20, reasons: [] },
    manipulationRisk: { level: 'low', score: 8, reasons: [] },
    timeframes: {
      m5: makeTimeframe('5m'),
      h1: makeTimeframe('1h'),
      h6: makeTimeframe('6h'),
      h24: makeTimeframe('24h')
    },
    liquidityRegime: 'HEALTHY_LIQUIDITY',
    volumeQuality: { score: 70, level: 'good' },
    alertPriority: 'medium',
    secondarySignals: ['BUY_TXN_DOMINANCE'],
    contradictorySignals: [],
    warnings: [],
    evidence: ['Buy dominance has persisted.'],
    detectorScores: [],
    dataQuality: {
      score: 80,
      historySnapshots: 12,
      missingFields: [],
      warnings: [],
      hasMinimumActivity: true,
      hasEnoughHistory: true,
      hasReliableLiquidity: true
    },
    ruleVersion: 'v3.1.0',
    pairReliability: { score: 72, tier: 'high', reasons: [] }
  };
}

function makeTimeframe(timeframe: '5m' | '1h' | '6h' | '24h') {
  return {
    timeframe,
    rawPriceChange: 2,
    normalizedMove: 1,
    direction: 'bullish' as const,
    directionScore: 40,
    momentumScore: 35,
    volumeConfirmation: 'confirming' as const,
    liquidityConfirmation: 'supportive' as const,
    reliability: 80
  };
}

function makeEvent(): DetectionEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    eventType: 'Accumulation',
    summary: 'Accumulation detected.',
    sentiment: 'bullish',
    severity: 'low',
    score: 74,
    detectedAt: Date.parse('2026-06-16T12:00:00.000Z'),
    token: {
      name: 'Token',
      ticker: 'TOK',
      address: 'TokenAddress',
      chain: 'solana',
      pairAddress: 'PairAddress'
    },
    metrics: {
      volume24h: 100_000,
      liquidity: 25_000,
      marketCap: 100_000,
      priceChange24h: 18,
      netFlow: 8
    },
    classificationId: '22222222-2222-4222-8222-222222222222',
    dedupeKey: 'solana:pair:ACCUMULATION'
  };
}
