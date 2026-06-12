import { describe, expect, it } from 'vitest';
import { buildDetectionEvent, dedupeKeyFor, shouldCreateDetectionEvent } from './events';
import type { FinalClassification, TimeframeAnalysis, TokenRecord } from './types';

describe('detection event mapping', () => {
  it('creates attention events for high-priority classifications', () => {
    const classification = makeClassification({ primaryLabel: 'LIQUIDITY_DRAIN', riskLevel: 'critical', alertPriority: 'critical' });

    expect(shouldCreateDetectionEvent(classification, null)).toBe(true);
    expect(dedupeKeyFor('solana:pair', classification)).toBe('solana:pair:LIQUIDITY_DRAIN');

    const event = buildDetectionEvent(makeRecord(), classification, 'classification-id');
    expect(event.eventType).toBe('Liquidity Drain');
    expect(event.sentiment).toBe('bearish');
    expect(event.severity).toBe('critical');
    expect(event.token.ticker).toBe('TEST');
    expect(event.lifecycleId).toBe('solana:pair:LIQUIDITY_DRAIN');
  });

  it('keeps quiet labels out of the feed', () => {
    expect(shouldCreateDetectionEvent(makeClassification({ primaryLabel: 'LOW_ACTIVITY', alertPriority: 'none' }), null)).toBe(false);
    expect(shouldCreateDetectionEvent(makeClassification({ primaryLabel: 'UNKNOWN', alertPriority: 'none' }), null)).toBe(false);
  });

  it('maps contextual direction labels without keyword confusion', () => {
    expect(buildDetectionEvent(makeRecord(), makeClassification({
      primaryLabel: 'BULLISH_BREAKDOWN_ATTEMPT',
      displayLabel: 'Bullish Breakdown Attempt'
    }), 'breakdown-id').sentiment).toBe('bearish');

    expect(buildDetectionEvent(makeRecord(), makeClassification({
      primaryLabel: 'BEARISH_REVERSAL_ATTEMPT',
      displayLabel: 'Bearish Reversal Attempt'
    }), 'reversal-id').sentiment).toBe('bullish');
  });
});

function makeRecord(): TokenRecord {
  return {
    token: {
      tokenId: 'solana:pair',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      tokenAddress: 'TokenAddress',
      chain: 'solana',
      pairAddress: 'pair',
      dexId: 'pumpswap',
      pairUrl: 'https://dexscreener.com/solana/pair'
    },
    snapshot: {
      tokenId: 'solana:pair',
      timestamp: new Date().toISOString(),
      priceUsd: 0.01,
      marketCap: 100_000,
      liquidityUsd: 50_000,
      volume5m: 5_000,
      volume1h: 20_000,
      volume6h: 80_000,
      volume24h: 200_000,
      buys5m: 10,
      sells5m: 40,
      traders5m: 50,
      priceChange5m: -8,
      priceChange1h: -12,
      priceChange6h: -20,
      priceChange24h: -25,
      raw: {}
    }
  };
}

function makeClassification(overrides: Partial<FinalClassification> = {}): FinalClassification {
  return {
    tokenId: 'solana:pair',
    timestamp: new Date().toISOString(),
    ruleLabel: 'LIQUIDITY_DRAIN',
    ruleConfidence: 86,
    finalLabel: 'LIQUIDITY_DRAIN',
    finalConfidence: 86,
    riskLevel: 'critical',
    reason: 'Liquidity dropped while sell pressure expanded.',
    primaryLabel: 'LIQUIDITY_DRAIN',
    displayLabel: 'Liquidity Drain',
    marketPhase: 'DANGER',
    structuralRegime: 'BEARISH',
    activeRegime: 'DANGER',
    dominantTimeframe: '5m',
    dominantReason: '5m movement dominated current behavior.',
    lowerTimeframeTrigger: '5M_LIQUIDITY_DROP',
    timeframeAlignment: { status: 'aligned_bearish', score: 85, conflictSeverity: 'none' },
    trendChange: 'WORSENING',
    eventStatus: 'new',
    confidence: {
      triggerConfidence: 86,
      regimeConfidence: 80,
      interpretationConfidence: 82,
      dataConfidence: 75,
      finalConfidence: 86
    },
    risk: { level: 'critical', score: 90, reasons: ['Liquidity shock'] },
    manipulationRisk: { level: 'high', score: 70, reasons: [] },
    timeframes: {
      m5: emptyTimeframe('5m'),
      h1: emptyTimeframe('1h'),
      h6: emptyTimeframe('6h'),
      h24: emptyTimeframe('24h')
    },
    liquidityRegime: 'LIQUIDITY_SHOCK',
    volumeQuality: { score: 72, level: 'good' },
    alertPriority: 'critical',
    secondarySignals: ['SELL_TXN_DOMINANCE'],
    contradictorySignals: [],
    warnings: [],
    evidence: ['Liquidity dropped while sell pressure expanded.'],
    detectorScores: [],
    dataQuality: {
      score: 75,
      historySnapshots: 5,
      missingFields: [],
      warnings: [],
      hasMinimumActivity: true,
      hasEnoughHistory: true,
      hasReliableLiquidity: true
    },
    ruleVersion: 'v3.0.0',
    ...overrides
  };
}

function emptyTimeframe(timeframe: '5m' | '1h' | '6h' | '24h'): TimeframeAnalysis {
  return {
    timeframe,
    rawPriceChange: 0,
    normalizedMove: 0,
    direction: 'neutral',
    directionScore: 0,
    momentumScore: 0,
    volumeConfirmation: 'unknown',
    liquidityConfirmation: 'unknown',
    reliability: 0
  };
}
