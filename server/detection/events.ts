import type { DetectionEvent } from '../../src/shared/detection';
import { isMarketStructureLabel, isSafetyLabel } from './classifierLabels';
import type { FinalClassification, PrimaryLabel, RiskLevel, TokenRecord } from './types';

const QUIET_LABELS = new Set(['LOW_ACTIVITY', 'INSUFFICIENT_DATA', 'UNKNOWN', 'CONSOLIDATION']);

export function shouldCreateDetectionEvent(classification: FinalClassification, previous: FinalClassification | null) {
  const label = classification.primaryLabel || classification.finalLabel;
  if (QUIET_LABELS.has(label)) return false;
  if (isMarketStructureLabel(label) && classification.confirmationStatus !== 'confirmed') return false;
  if (isSafetyLabel(label) && (classification.alertPriority !== 'none' || classification.riskLevel === 'critical' || classification.riskLevel === 'high')) return true;
  if (classification.alertPriority !== 'none') return true;
  if (classification.riskLevel === 'critical' || classification.riskLevel === 'high') return true;
  if (classification.eventStatus === 'new' && classification.finalConfidence >= 60) return true;
  if (classification.eventStatus === 'strengthening' && classification.finalConfidence >= 55) return true;
  if (!previous) return false;
  if (previous.primaryLabel !== classification.primaryLabel) return classification.finalConfidence >= 65;
  if (previous.riskLevel !== classification.riskLevel) return true;
  if (previous.eventStatus !== classification.eventStatus) return true;
  if (Math.abs(classification.finalConfidence - previous.finalConfidence) >= 12) return true;
  if (Math.abs((classification.risk?.score || 0) - (previous.risk?.score || 0)) >= 15) return true;
  return false;
}

export function buildDetectionEvent(record: TokenRecord, classification: FinalClassification, classificationId: string): DetectionEvent {
  const raw = record.snapshot.raw as { logo?: string | null; overview?: { logo?: string; dexFlowUsd24h?: number } } | null;
  const volume24h = record.snapshot.volume24h || 0;
  const liquidity = record.snapshot.liquidityUsd || 0;
  const marketCap = record.snapshot.marketCap || 0;
  const overviewNetFlow = Number(raw?.overview?.dexFlowUsd24h);
  const totalTxns5m = record.snapshot.buys5m + record.snapshot.sells5m;
  const estimatedBuyVolume5m = totalTxns5m > 0 ? record.snapshot.volume5m * (record.snapshot.buys5m / totalTxns5m) : record.snapshot.volume5m / 2;
  const estimatedSellVolume5m = Math.max(0, record.snapshot.volume5m - estimatedBuyVolume5m);
  const estimatedNetFlow5m = estimatedBuyVolume5m - estimatedSellVolume5m;
  const netFlow = Number.isFinite(overviewNetFlow) && overviewNetFlow !== 0 ? overviewNetFlow : estimatedNetFlow5m;

  return {
    id: classificationId,
    eventType: classification.displayLabel || classification.primaryLabel.replaceAll('_', ' '),
    summary: classification.reason,
    sentiment: sentimentForLabel(classification.primaryLabel),
    severity: classification.riskLevel,
    score: classification.finalConfidence,
    detectedAt: Date.parse(classification.timestamp) || Date.now(),
    token: {
      name: record.token.tokenName || record.token.tokenSymbol || 'Unknown token',
      ticker: record.token.tokenSymbol || record.token.tokenName || 'TOKEN',
      address: record.token.tokenAddress,
      chain: record.token.chain,
      pairAddress: record.token.pairAddress,
      logo: raw?.logo || raw?.overview?.logo || undefined
    },
    metrics: {
      volume24h,
      liquidity,
      marketCap,
      priceChange24h: record.snapshot.priceChange24h,
      netFlow
    },
    classificationId,
    dedupeKey: dedupeKeyFor(record.token.tokenId, classification),
    lifecycleId: lifecycleIdFor(record.token.tokenId, classification),
    lifecycleStatus: classification.eventStatus,
    eventVersion: 1,
    lastUpdatedAt: Date.parse(classification.timestamp) || Date.now(),
    previousScore: null,
    scoreDelta: null,
    riskDelta: null
  };
}

export function dedupeKeyFor(tokenId: string, classification: FinalClassification) {
  return lifecycleIdFor(tokenId, classification);
}

export function lifecycleIdFor(tokenId: string, classification: FinalClassification) {
  return [tokenId, classification.primaryLabel].join(':');
}

function sentimentForLabel(label: PrimaryLabel): DetectionEvent['sentiment'] {
  return SENTIMENT_BY_LABEL[label] || 'neutral';
}

const SENTIMENT_BY_LABEL: Record<PrimaryLabel, DetectionEvent['sentiment']> = {
  BULLISH_CONTINUATION_PUMP: 'bullish',
  BEARISH_CONTINUATION_DUMP: 'bearish',
  BEARISH_RELIEF_BOUNCE: 'neutral',
  BULLISH_PULLBACK: 'neutral',
  BEARISH_REVERSAL_ATTEMPT: 'bullish',
  BULLISH_BREAKDOWN_ATTEMPT: 'bearish',
  RANGE_BREAKOUT_ATTEMPT: 'bullish',
  RANGE_BREAKDOWN_ATTEMPT: 'bearish',
  LOW_LIQUIDITY_PRICE_SPIKE: 'neutral',
  LOW_LIQUIDITY_SELL_OFF: 'bearish',
  LIQUIDITY_DRAIN: 'bearish',
  LIQUIDITY_ADDED: 'bullish',
  PUMP: 'bullish',
  DUMP: 'bearish',
  BUY_RECOVERY: 'bullish',
  SELL_OFF: 'bearish',
  ACCUMULATION: 'bullish',
  DISTRIBUTION: 'bearish',
  CONSOLIDATION: 'neutral',
  LOW_ACTIVITY: 'neutral',
  INSUFFICIENT_DATA: 'neutral',
  UNKNOWN: 'neutral'
};

export function severityScore(severity: RiskLevel) {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}
