import type { DetectionEvent } from '../../src/shared/detection';
import type { FinalClassification, RiskLevel, TokenRecord } from './types';

const QUIET_LABELS = new Set(['LOW_ACTIVITY', 'INSUFFICIENT_DATA', 'UNKNOWN', 'CONSOLIDATION']);

export function shouldCreateDetectionEvent(classification: FinalClassification, previous: FinalClassification | null) {
  const label = classification.primaryLabel || classification.finalLabel;
  if (QUIET_LABELS.has(label)) return false;
  if (classification.alertPriority !== 'none') return true;
  if (classification.riskLevel === 'critical' || classification.riskLevel === 'high') return true;
  if (classification.eventStatus === 'new' && classification.finalConfidence >= 60) return true;
  if (classification.eventStatus === 'strengthening' && classification.finalConfidence >= 55) return true;
  return previous?.primaryLabel !== classification.primaryLabel && classification.finalConfidence >= 65;
}

export function buildDetectionEvent(record: TokenRecord, classification: FinalClassification, classificationId: string): DetectionEvent {
  const raw = record.snapshot.raw as { logo?: string | null; overview?: { logo?: string } } | null;
  const volume24h = record.snapshot.volume24h || 0;
  const liquidity = record.snapshot.liquidityUsd || 0;
  const marketCap = record.snapshot.marketCap || 0;

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
      netFlow: record.snapshot.buys5m - record.snapshot.sells5m
    },
    classificationId,
    dedupeKey: dedupeKeyFor(record.token.tokenId, classification)
  };
}

export function dedupeKeyFor(tokenId: string, classification: FinalClassification) {
  return [
    tokenId,
    classification.primaryLabel,
    classification.riskLevel,
    classification.eventStatus
  ].join(':');
}

function sentimentForLabel(label: string): DetectionEvent['sentiment'] {
  if (label.includes('BULLISH') || label.includes('PUMP') || label.includes('ACCUMULATION') || label === 'LIQUIDITY_ADDED' || label === 'BUY_RECOVERY') {
    return 'bullish';
  }
  if (label.includes('BEARISH') || label.includes('DUMP') || label.includes('DRAIN') || label.includes('SELL') || label === 'DISTRIBUTION') {
    return 'bearish';
  }
  return 'neutral';
}

export function severityScore(severity: RiskLevel) {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}
