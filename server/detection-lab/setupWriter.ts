import type { DetectionEvent } from '../../src/shared/detection';
import type { FinalClassification, TokenFeatures, TokenRecord } from '../detection/types';
import { detectionResearchEnabled } from './config';
import { DetectionResearchStore, type ResearchSetupRow } from './store';

type SaveDetectionSetupInput = {
  record: TokenRecord;
  features: TokenFeatures;
  classification: FinalClassification;
  event: DetectionEvent;
  historySnapshots: number;
};

export async function saveDetectionEventSetup(
  input: SaveDetectionSetupInput,
  store = new DetectionResearchStore()
) {
  if (!detectionResearchEnabled()) return;
  await store.saveEventSetup(toSetupRow(input));
}

export function toSetupRow(input: SaveDetectionSetupInput): ResearchSetupRow {
  const { record, features, classification, event, historySnapshots } = input;
  const { token, snapshot } = record;
  return {
    event_id: event.id,
    classification_id: event.classificationId || null,
    token_id: token.tokenId,
    token_address: token.tokenAddress,
    pair_address: token.pairAddress,
    chain: token.chain,
    dex_id: token.dexId,
    event_label: classification.primaryLabel,
    alert_timestamp: classification.timestamp,
    rule_version: classification.ruleVersion || null,
    confidence: classification.finalConfidence,
    risk_level: classification.riskLevel,
    risk_score: classification.risk?.score ?? null,
    manipulation_risk_level: classification.manipulationRisk?.level ?? null,
    manipulation_risk_score: classification.manipulationRisk?.score ?? null,
    alert_priority: classification.alertPriority,
    confirmation_status: classification.confirmationStatus,
    confirmation_score: classification.confirmationScore,
    classification_basis: classification.classificationBasis,
    event_horizon: classification.eventHorizon,
    dominant_timeframe: classification.dominantTimeframe,
    structural_regime: classification.structuralRegime,
    active_regime: classification.activeRegime,
    lower_timeframe_trigger: classification.lowerTimeframeTrigger,
    trend_change: classification.trendChange,
    price_usd: snapshot.priceUsd,
    market_cap: snapshot.marketCap,
    liquidity_usd: snapshot.liquidityUsd,
    volume_5m: snapshot.volume5m,
    volume_1h: snapshot.volume1h,
    volume_6h: snapshot.volume6h,
    volume_24h: snapshot.volume24h,
    buys_5m: snapshot.buys5m,
    sells_5m: snapshot.sells5m,
    traders_5m: snapshot.traders5m,
    price_change_5m: snapshot.priceChange5m,
    price_change_1h: snapshot.priceChange1h,
    price_change_6h: snapshot.priceChange6h,
    price_change_24h: snapshot.priceChange24h,
    total_txns_5m: features.totalTxns5m,
    buy_sell_ratio: features.buySellRatio,
    buy_txn_dominance: features.buyTxnDominance,
    sell_txn_dominance: features.sellTxnDominance,
    net_txn_pressure: features.netTxnPressure,
    liquidity_change_percentage: features.liquidityChangePercentage,
    liquidity_change_usd: features.liquidityChangeUsd,
    volume_to_liquidity_ratio: features.volumeToLiquidityRatio,
    volume_spike_score: features.volumeSpikeScore,
    volume_spike_persisted_snapshots: features.volumeSpikePersistedSnapshots,
    volume_quality_score: features.volumeQualityScore,
    volume_quality_level: features.volumeQualityLevel,
    liquidity_regime: features.liquidityRegime,
    liquidity_state: features.liquidityState,
    pressure_state: features.pressureState,
    price_momentum_score: features.priceMomentumScore,
    volatility_score: features.volatilityScore,
    consecutive_green_snapshots: features.consecutiveGreenSnapshots,
    consecutive_red_snapshots: features.consecutiveRedSnapshots,
    consecutive_buy_dominant_snapshots: features.consecutiveBuyDominantSnapshots,
    consecutive_sell_dominant_snapshots: features.consecutiveSellDominantSnapshots,
    trend_direction: features.trendDirection,
    data_quality_score: classification.dataQuality?.score ?? null,
    history_snapshots: historySnapshots,
    pair_reliability_tier: classification.pairReliability?.tier ?? snapshot.pairReliability?.tier ?? null,
    pair_reliability_score: classification.pairReliability?.score ?? snapshot.pairReliability?.score ?? null,
    secondary_signals: classification.secondarySignals || [],
    contradictory_signals: classification.contradictorySignals || [],
    warnings: classification.warnings || [],
    context_summary: {
      eventType: event.eventType,
      sentiment: event.sentiment,
      severity: event.severity,
      evidence: classification.evidence,
      timeframes: classification.timeframes,
      dataQuality: classification.dataQuality,
      timeframeAlignment: classification.timeframeAlignment,
      detectorScores: classification.detectorScores,
      tokenAgeMinutes: classification.tokenAgeMinutes ?? null,
      regimeWeights: classification.regimeWeights ?? null
    }
  };
}
