import { describe, expect, it } from 'vitest';
import { buildBaselineReportFromRows } from './baselineReport';
import type { OutcomeRow, ResearchSetupRow } from './store';

describe('detection lab baseline report', () => {
  it('summarizes event outcomes by label', () => {
    const report = buildBaselineReportFromRows(
      [makeSetup('one', 'ACCUMULATION'), makeSetup('two', 'ACCUMULATION'), makeSetup('three', 'DISTRIBUTION')],
      [makeOutcome('one', 'win', 600), makeOutcome('two', 'loss', -700), makeOutcome('three', 'neutral', -100)]
    );

    expect(report.sampleSize).toBe(3);
    expect(report.labels[0]).toMatchObject({
      eventLabel: 'ACCUMULATION',
      sampleSize: 2,
      completed: 2,
      wins: 1,
      losses: 1,
      winRateBps: 5_000
    });
  });
});

function makeSetup(eventId: string, label: string): ResearchSetupRow {
  return {
    event_id: eventId,
    classification_id: null,
    token_id: `token:${eventId}`,
    token_address: 'address',
    pair_address: 'pair',
    chain: 'solana',
    dex_id: null,
    event_label: label,
    alert_timestamp: '2026-06-16T12:00:00.000Z',
    rule_version: 'v3.1.0',
    confidence: 70,
    risk_level: 'low',
    risk_score: 20,
    manipulation_risk_level: 'low',
    manipulation_risk_score: 10,
    alert_priority: 'medium',
    confirmation_status: 'confirmed',
    confirmation_score: 70,
    classification_basis: 'higher_timeframe_confirmed',
    event_horizon: '6h',
    dominant_timeframe: '6h',
    structural_regime: 'BULLISH',
    active_regime: 'CONTINUATION',
    lower_timeframe_trigger: 'NONE',
    trend_change: 'UNCHANGED',
    price_usd: 1,
    market_cap: 100_000,
    liquidity_usd: 50_000,
    volume_5m: 1_000,
    volume_1h: 10_000,
    volume_6h: 50_000,
    volume_24h: 100_000,
    buys_5m: 10,
    sells_5m: 5,
    traders_5m: 15,
    price_change_5m: 1,
    price_change_1h: 2,
    price_change_6h: 3,
    price_change_24h: 4,
    total_txns_5m: 15,
    buy_sell_ratio: 2,
    buy_txn_dominance: 0.67,
    sell_txn_dominance: 0.33,
    net_txn_pressure: 0.34,
    liquidity_change_percentage: 0,
    liquidity_change_usd: 0,
    volume_to_liquidity_ratio: 0.02,
    volume_spike_score: 1,
    volume_spike_persisted_snapshots: 0,
    volume_quality_score: 60,
    volume_quality_level: 'moderate',
    liquidity_regime: 'HEALTHY_LIQUIDITY',
    liquidity_state: 'stable',
    pressure_state: 'balanced',
    price_momentum_score: 2,
    volatility_score: 5,
    consecutive_green_snapshots: 1,
    consecutive_red_snapshots: 0,
    consecutive_buy_dominant_snapshots: 2,
    consecutive_sell_dominant_snapshots: 0,
    trend_direction: 'uptrend',
    data_quality_score: 80,
    history_snapshots: 8,
    pair_reliability_tier: 'high',
    pair_reliability_score: 80,
    secondary_signals: [],
    contradictory_signals: [],
    warnings: [],
    context_summary: {}
  };
}

function makeOutcome(eventId: string, result: OutcomeRow['result'], return6h: number): OutcomeRow {
  return {
    event_id: eventId,
    token_id: `token:${eventId}`,
    scored_at: '2026-06-16T18:00:00.000Z',
    outcome_status: 'complete',
    alert_price_usd: 1,
    alert_liquidity_usd: 50_000,
    price_15m: null,
    price_1h: null,
    price_3h: null,
    price_6h: 1 + return6h / 10_000,
    price_12h: null,
    price_24h: null,
    return_15m_bps: null,
    return_1h_bps: null,
    return_3h_bps: null,
    return_6h_bps: return6h,
    return_12h_bps: null,
    return_24h_bps: null,
    liquidity_15m: null,
    liquidity_1h: null,
    liquidity_3h: null,
    liquidity_6h: null,
    liquidity_12h: null,
    liquidity_24h: null,
    liquidity_change_1h_bps: null,
    liquidity_change_6h_bps: null,
    liquidity_change_24h_bps: null,
    max_upside_24h_bps: Math.max(return6h, 0),
    max_drawdown_24h_bps: Math.min(return6h, 0),
    time_to_max_upside_minutes: null,
    time_to_max_drawdown_minutes: null,
    target_hit: null,
    invalidation_hit: null,
    result,
    notes: null,
    updated_at: '2026-06-16T18:00:00.000Z'
  };
}
