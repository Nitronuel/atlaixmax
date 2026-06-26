import { calculateDataQuality } from "./dataQuality";
import { detectionEventSummaryForLabel } from "../../src/shared/detection-copy";
import { LABEL_PRIORITY, displayLabelFor, isMarketStructureLabel, isSafetyLabel, resolveAlertPriority, resolveMarketPhase } from "./classifierLabels";
import { triggerToSignal } from "./classifierSignals";
import { clamp, formatPercent, riskLevelFor, unique } from "./classifierUtils";
import { isMeaningfulLiquidityShock } from "./features";
import type {
  ActiveRegime,
  BehaviorLabel,
  ClassificationBasis,
  ConfidenceBreakdown,
  ConfirmationStatus,
  DataQuality,
  DominantTimeframe,
  EventHorizon,
  EventStatus,
  FinalClassification,
  LowerTimeframeTrigger,
  ManipulationRisk,
  PairReliability,
  PrimaryLabel,
  RiskAssessment,
  RiskLevel,
  SignalLabel,
  StructuralRegime,
  TimeframeAlignment,
  TimeframeAnalysis,
  TokenFeatures,
  TokenSnapshot,
  TrendChange
} from "./types";

export const RULE_VERSION = "v3.1.0";

interface ClassificationInput {
  snapshot: TokenSnapshot;
  features: TokenFeatures;
  history: TokenSnapshot[];
  previousClassification: FinalClassification | null;
}

interface Context {
  snapshot: TokenSnapshot;
  features: TokenFeatures;
  history: TokenSnapshot[];
  previousClassification: FinalClassification | null;
  dataQuality: DataQuality;
  timeframes: Record<"m5" | "h1" | "h6" | "h24", TimeframeAnalysis>;
  regimeWeights: Record<"m5" | "h1" | "h6" | "h24", number>;
  tokenAgeMinutes: number | null;
  pairReliability: PairReliability | null;
  structuralRegime: StructuralRegime;
  lowerTimeframeTrigger: LowerTimeframeTrigger;
  timeframeAlignment: TimeframeAlignment;
  trendChange: TrendChange;
}

type TimeframeKey = "m5" | "h1" | "h6" | "h24";
type TimeframeWeights = Record<TimeframeKey, number>;
type DirectionBias = "bullish" | "bearish" | "neutral";
type ConfirmationResult = {
  eventHorizon: EventHorizon;
  confirmationStatus: ConfirmationStatus;
  confirmationScore: number;
  classificationBasis: ClassificationBasis;
};

export function classifyToken(input: ClassificationInput): FinalClassification {
  const dataQuality = calculateDataQuality(input.snapshot, input.features, input.history);
  const tokenAgeMinutes = estimateTokenAgeMinutes(input.snapshot, input.history);
  const timeframes = calculateTimeframes(input.snapshot, input.history, input.features);
  const regimeWeights = getRegimeWeights(tokenAgeMinutes, dataQuality.score);
  const pairReliability = getPairReliability(input.snapshot);
  const structuralRegime = calculateStructuralRegime(timeframes, regimeWeights);
  const lowerTimeframeTrigger = detectLowerTimeframeTrigger(input.snapshot, input.features, dataQuality);
  const timeframeAlignment = calculateTimeframeAlignment(timeframes, structuralRegime, regimeWeights);
  const trendChange = calculateTrendChange(input.snapshot, input.history[0] ?? null);
  const context: Context = {
    ...input,
    dataQuality,
    timeframes,
    regimeWeights,
    tokenAgeMinutes,
    pairReliability,
    structuralRegime,
    lowerTimeframeTrigger,
    timeframeAlignment,
    trendChange
  };

  const candidateLabel = resolveContextualLabel(context);
  const candidateConfirmation = calculateHigherTimeframeConfirmation(context, candidateLabel);
  const interpretedLabel = applyConfirmationGate(context, candidateLabel, candidateConfirmation);
  const primaryLabel = applyHysteresis(interpretedLabel, context);
  const confirmation = primaryLabel === candidateLabel
    ? candidateConfirmation
    : { ...candidateConfirmation, classificationBasis: "short_term_watch" as const };
  const activeRegime = calculateActiveRegime(context, primaryLabel);
  const dominant = detectDominantTimeframe(timeframes, structuralRegime);
  const secondarySignals = getSecondarySignals(context);
  const contradictorySignals = getContradictorySignals(context, primaryLabel);
  const confidence = calculateConfidence(context, primaryLabel, contradictorySignals, secondarySignals);
  const risk = calculateRisk(context, primaryLabel, contradictorySignals);
  const manipulationRisk = calculateManipulationRisk(context);
  const eventStatus = calculateEventStatus(context.previousClassification, primaryLabel, confidence.finalConfidence);
  const evidence = buildEvidence(context, primaryLabel, candidateLabel, confirmation);
  const warnings = buildWarnings(context, primaryLabel, candidateLabel, confirmation, contradictorySignals, risk, manipulationRisk);
  const displayLabel = displayLabelFor(primaryLabel);
  const reason = detectionEventSummaryForLabel(primaryLabel, evidence[0] ?? displayLabel);

  return {
    tokenId: input.snapshot.tokenId,
    timestamp: input.snapshot.timestamp,
    ruleLabel: toBehaviorLabel(primaryLabel),
    ruleConfidence: confidence.finalConfidence,
    finalLabel: toBehaviorLabel(primaryLabel),
    finalConfidence: confidence.finalConfidence,
    riskLevel: risk.level,
    reason,
    primaryLabel,
    displayLabel,
    marketPhase: resolveMarketPhase(primaryLabel),
    structuralRegime,
    activeRegime,
    dominantTimeframe: dominant.timeframe,
    dominantReason: dominant.reason,
    eventHorizon: confirmation.eventHorizon,
    confirmationStatus: confirmation.confirmationStatus,
    confirmationScore: confirmation.confirmationScore,
    classificationBasis: confirmation.classificationBasis,
    lowerTimeframeTrigger,
    timeframeAlignment,
    trendChange,
    eventStatus,
    confidence,
    risk,
    manipulationRisk,
    timeframes,
    liquidityRegime: input.features.liquidityRegime,
    volumeQuality: {
      score: input.features.volumeQualityScore,
      level: input.features.volumeQualityLevel
    },
    alertPriority: resolveAlertPriority(primaryLabel, risk.level, confidence.finalConfidence, confirmation.confirmationStatus),
    secondarySignals,
    contradictorySignals,
    warnings,
    evidence,
    detectorScores: buildDetectorScores(context, primaryLabel, confidence, risk.level),
    dataQuality,
    ruleVersion: RULE_VERSION,
    tokenAgeMinutes,
    regimeWeights,
    pairReliability
  };
}

function calculateTimeframes(snapshot: TokenSnapshot, history: TokenSnapshot[], features: TokenFeatures): Context["timeframes"] {
  const deoverlapped = calculateDeoverlappedChanges(snapshot, history);
  return {
    m5: analyzeTimeframe("5m", snapshot.priceChange5m, baseline(history, "priceChange5m"), features, deoverlapped.m5),
    h1: analyzeTimeframe("1h", snapshot.priceChange1h, baseline(history, "priceChange1h"), features, deoverlapped.h1),
    h6: analyzeTimeframe("6h", snapshot.priceChange6h, baseline(history, "priceChange6h"), features, deoverlapped.h6),
    h24: analyzeTimeframe("24h", snapshot.priceChange24h, baseline(history, "priceChange24h"), features, deoverlapped.h24)
  };
}

function analyzeTimeframe(
  timeframe: TimeframeAnalysis["timeframe"],
  rawPriceChange: number,
  normalMove: number,
  features: TokenFeatures,
  deoverlappedPriceChange: number | null
): TimeframeAnalysis {
  const effectivePriceChange = deoverlappedPriceChange ?? rawPriceChange;
  const normalizedMove = effectivePriceChange / Math.max(normalMove, 1);
  const directionScore = directionScoreFor(normalizedMove);
  return {
    timeframe,
    rawPriceChange,
    deoverlappedPriceChange,
    normalizedMove,
    direction: directionForScore(directionScore),
    directionScore,
    momentumScore: clamp(Math.round(directionScore * 0.7 + normalizedMove * 6), -100, 100),
    volumeConfirmation: getVolumeConfirmation(effectivePriceChange, features),
    liquidityConfirmation: getLiquidityConfirmation(features),
    reliability: getTimeframeReliability(effectivePriceChange, features)
  };
}

function directionScoreFor(normalizedMove: number): number {
  if (normalizedMove >= 4) return 100;
  if (normalizedMove >= 2) return 70;
  if (normalizedMove >= 1) return 40;
  if (normalizedMove <= -4) return -100;
  if (normalizedMove <= -2) return -70;
  if (normalizedMove <= -1) return -40;
  return 0;
}

function directionForScore(score: number): TimeframeAnalysis["direction"] {
  if (score >= 70) return "strong_bullish";
  if (score >= 25) return "bullish";
  if (score <= -70) return "strong_bearish";
  if (score <= -25) return "bearish";
  return "neutral";
}

function calculateDeoverlappedChanges(snapshot: TokenSnapshot, history: TokenSnapshot[]): Record<TimeframeKey, number | null> {
  const currentMs = Date.parse(snapshot.timestamp);
  if (!Number.isFinite(currentMs)) return { m5: null, h1: null, h6: null, h24: null };

  return {
    m5: null,
    h1: segmentPriceChange(history, currentMs, 60, 5, 20),
    h6: segmentPriceChange(history, currentMs, 360, 60, 90),
    h24: segmentPriceChange(history, currentMs, 1_440, 360, 240)
  };
}

function segmentPriceChange(history: TokenSnapshot[], currentMs: number, startAgoMinutes: number, endAgoMinutes: number, toleranceMinutes: number) {
  const start = closestSnapshot(history, currentMs - startAgoMinutes * 60_000, toleranceMinutes * 60_000);
  const end = closestSnapshot(history, currentMs - endAgoMinutes * 60_000, toleranceMinutes * 60_000);
  if (!start?.priceUsd || !end?.priceUsd) return null;
  return ((end.priceUsd - start.priceUsd) / start.priceUsd) * 100;
}

function closestSnapshot(history: TokenSnapshot[], targetMs: number, toleranceMs: number) {
  let closest: TokenSnapshot | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const snapshot of history) {
    const timestamp = Date.parse(snapshot.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    const distance = Math.abs(timestamp - targetMs);
    if (distance < closestDistance && distance <= toleranceMs) {
      closest = snapshot;
      closestDistance = distance;
    }
  }
  return closest;
}

function estimateTokenAgeMinutes(snapshot: TokenSnapshot, history: TokenSnapshot[]): number | null {
  const raw = snapshot.raw as { pair?: { pairCreatedAt?: number | null }; overview?: { pairCreatedAt?: number | null } } | null;
  const createdAt = normalizeEpochMs(snapshot.pairCreatedAt ?? raw?.pair?.pairCreatedAt ?? raw?.overview?.pairCreatedAt ?? null);
  const currentMs = Date.parse(snapshot.timestamp);
  if (createdAt && Number.isFinite(currentMs) && currentMs > createdAt) return Math.round((currentMs - createdAt) / 60_000);
  const oldest = history.at(-1);
  const oldestMs = oldest ? Date.parse(oldest.timestamp) : NaN;
  if (Number.isFinite(currentMs) && Number.isFinite(oldestMs) && currentMs > oldestMs) return Math.round((currentMs - oldestMs) / 60_000);
  return null;
}

function normalizeEpochMs(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return null;
  return value < 10_000_000_000 ? value * 1_000 : value;
}

function getRegimeWeights(tokenAgeMinutes: number | null, dataQualityScore: number): TimeframeWeights {
  if (dataQualityScore < 55) return { m5: 0.35, h1: 0.4, h6: 0.25, h24: 0 };
  if (tokenAgeMinutes !== null && tokenAgeMinutes < 120) return { m5: 0.45, h1: 0.35, h6: 0.2, h24: 0 };
  if (tokenAgeMinutes !== null && tokenAgeMinutes < 360) return { m5: 0.3, h1: 0.4, h6: 0.3, h24: 0 };
  if (tokenAgeMinutes !== null && tokenAgeMinutes < 1_440) return { m5: 0.15, h1: 0.35, h6: 0.35, h24: 0.15 };
  return { m5: 0, h1: 0.3, h6: 0.45, h24: 0.25 };
}

function structuralScoreFor(timeframes: Context["timeframes"], weights: TimeframeWeights) {
  return timeframes.m5.directionScore * weights.m5 +
    timeframes.h1.directionScore * weights.h1 +
    timeframes.h6.directionScore * weights.h6 +
    timeframes.h24.directionScore * weights.h24;
}

function getPairReliability(snapshot: TokenSnapshot): PairReliability | null {
  if (snapshot.pairReliability) return snapshot.pairReliability;
  const raw = snapshot.raw as { pairReliability?: PairReliability | null } | null;
  return raw?.pairReliability || null;
}

function calculateStructuralRegime(timeframes: Context["timeframes"], weights: TimeframeWeights): StructuralRegime {
  const score = structuralScoreFor(timeframes, weights);
  if (score >= 60) return "STRONG_BULLISH";
  if (score >= 25) return "BULLISH";
  if (score <= -60) return "STRONG_BEARISH";
  if (score <= -25) return "BEARISH";
  if (Math.abs(timeframes.h1.directionScore - timeframes.h6.directionScore) >= 110) return "MIXED";
  return "SIDEWAYS";
}

function detectLowerTimeframeTrigger(snapshot: TokenSnapshot, features: TokenFeatures, dataQuality: DataQuality): LowerTimeframeTrigger {
  if (features.liquidityRegime === "LOW_LIQUIDITY" || features.liquidityRegime === "FRAGILE_LIQUIDITY") {
    if (snapshot.priceChange5m >= 8) return "LOW_LIQUIDITY_PRICE_SPIKE";
    if (snapshot.priceChange5m <= -8) return "LOW_LIQUIDITY_SELL_OFF";
  }
  if (isMeaningfulLiquidityShock(snapshot.liquidityUsd, features.liquidityChangePercentage, features.liquidityChangeUsd) && (features.liquidityChangeUsd ?? 0) < 0) return "5M_LIQUIDITY_DROP";
  if (features.liquidityState === "sudden_increase" && (features.liquidityChangeUsd ?? 0) >= 1_000) return "5M_LIQUIDITY_INCREASE";
  if (dataQuality.score < 45) return "LOW_ACTIVITY_MOVE";
  if (snapshot.priceChange5m >= 12 || (snapshot.priceChange5m >= 8 && features.volumeQualityScore >= 55)) return "SHARP_5M_PUMP";
  if (snapshot.priceChange5m <= -12 || (snapshot.priceChange5m <= -8 && features.volumeQualityScore >= 55)) return "SHARP_5M_DUMP";
  if (features.volumeSpikeScore >= 1.8) return "5M_VOLUME_SPIKE";
  if (features.buyTxnDominance >= 0.58) return "5M_BUY_TXN_DOMINANCE";
  if (features.sellTxnDominance >= 0.58) return "5M_SELL_TXN_DOMINANCE";
  return "NONE";
}

function calculateTimeframeAlignment(timeframes: Context["timeframes"], structuralRegime: StructuralRegime, weights: TimeframeWeights): TimeframeAlignment {
  const triggerScore = timeframes.m5.directionScore;
  const structuralScore = structuralScoreFor(timeframes, weights);
  const conflict = Math.abs(triggerScore - structuralScore);
  if (triggerScore >= 25 && structuralScore >= 25) return { status: "aligned_bullish", score: 100 - Math.round(conflict / 2), conflictSeverity: "none" };
  if (triggerScore <= -25 && structuralScore <= -25) return { status: "aligned_bearish", score: 100 - Math.round(conflict / 2), conflictSeverity: "none" };
  if (triggerScore >= 25 && structuralScore <= -25) return { status: "counter_trend_bullish", score: Math.round(conflict), conflictSeverity: conflictSeverity(conflict) };
  if (triggerScore <= -25 && structuralScore >= 25) return { status: "counter_trend_bearish", score: Math.round(conflict), conflictSeverity: conflictSeverity(conflict) };
  if (structuralRegime === "MIXED") return { status: "transitioning", score: 45, conflictSeverity: "medium" };
  return { status: "mixed", score: 35, conflictSeverity: "low" };
}

function calculateTrendChange(current: TokenSnapshot, previous: TokenSnapshot | null): TrendChange {
  if (!previous) return "UNCHANGED";
  const score =
    (current.priceChange1h - previous.priceChange1h) * 0.5 +
    (current.priceChange6h - previous.priceChange6h) * 0.35 +
    (current.priceChange24h - previous.priceChange24h) * 0.15;
  if (score >= 15) return "IMPROVING_STRONGLY";
  if (score >= 5) return "IMPROVING";
  if (score <= -15) return "WORSENING_STRONGLY";
  if (score <= -5) return "WORSENING";
  return "UNCHANGED";
}

function calculateHigherTimeframeConfirmation(context: Context, label: PrimaryLabel): ConfirmationResult {
  const dominant = detectDominantTimeframe(context.timeframes, context.structuralRegime);
  if (isSafetyLabel(label)) {
    return {
      eventHorizon: "5m",
      confirmationStatus: "confirmed",
      confirmationScore: 100,
      classificationBasis: "safety_override"
    };
  }

  if (!isMarketStructureLabel(label)) {
    return {
      eventHorizon: dominant.timeframe,
      confirmationStatus: "confirmed",
      confirmationScore: context.dataQuality.score,
      classificationBasis: "quiet_context"
    };
  }

  const score = confirmationScoreForMarketLabel(context, label);
  return {
    eventHorizon: dominant.timeframe === "5m" ? "1h" : dominant.timeframe,
    confirmationStatus: confirmationStatusFor(score),
    confirmationScore: score,
    classificationBasis: score >= 70 ? "higher_timeframe_confirmed" : "short_term_watch"
  };
}

function confirmationScoreForMarketLabel(context: Context, label: PrimaryLabel): number {
  let score = 0;
  const bias = directionBiasFor(label);
  const { features, dataQuality, pairReliability, timeframes } = context;
  const liquidityIsSupportive = features.liquidityState === "stable" || features.liquidityState === "increasing" || features.liquidityState === "sudden_increase";
  const liquidityIsDangerous = features.liquidityRegime === "LIQUIDITY_SHOCK" || features.liquidityRegime === "FRAGILE_LIQUIDITY" || features.liquidityRegime === "LOW_LIQUIDITY";

  if (dataQuality.hasMinimumActivity) score += 10;
  if (dataQuality.hasEnoughHistory) score += 10;
  if (features.volumeQualityScore >= 31) score += 10;
  if (liquidityIsSupportive) score += 15;
  if (liquidityIsDangerous) score -= 30;
  if (pairReliability?.tier === "low") score -= 10;

  if (label === "ACCUMULATION") {
    if (context.snapshot.priceChange1h < 1 || context.snapshot.priceChange6h < 1) score -= 35;
    if (context.snapshot.priceChange1h >= 0) score += 20;
    if (timeframes.h6.directionScore >= 0) score += 20;
    if (timeframes.h24.directionScore > -70) score += 10;
    if (features.consecutiveBuyDominantSnapshots >= 3) score += 20;
    if (features.volatilityScore < 18) score += 5;
    if (context.structuralRegime === "STRONG_BEARISH" || context.structuralRegime === "BEARISH") score -= 25;
    return clamp(score, 0, 100);
  }

  if (label === "DISTRIBUTION") {
    if (context.snapshot.priceChange1h > -1 || context.snapshot.priceChange6h > -1) score -= 35;
    if (context.snapshot.priceChange1h <= 0) score += 20;
    if (timeframes.h6.directionScore <= 0) score += 20;
    if (timeframes.h24.directionScore < 70) score += 10;
    if (features.consecutiveSellDominantSnapshots >= 3) score += 20;
    if (context.structuralRegime === "STRONG_BULLISH" || context.structuralRegime === "BULLISH") score -= 25;
    return clamp(score, 0, 100);
  }

  if (label === "LIQUIDITY_ADDED") {
    if (features.liquidityState === "sudden_increase" || features.liquidityState === "increasing") score += 30;
    if (context.snapshot.priceChange1h >= -2) score += 20;
    if (timeframes.h6.directionScore > -40) score += 15;
    return clamp(score, 0, 100);
  }

  if (bias === "bullish") {
    if (timeframes.h1.directionScore >= 25 || context.snapshot.priceChange1h >= 5) score += 25;
    if (timeframes.h6.directionScore >= 25 || context.snapshot.priceChange6h >= 8) score += 25;
    if (timeframes.h24.directionScore > -40) score += 10;
    if (timeframes.h6.directionScore <= -40 || timeframes.h24.directionScore <= -70) score -= 25;
  } else if (bias === "bearish") {
    if (timeframes.h1.directionScore <= -25 || context.snapshot.priceChange1h <= -5) score += 25;
    if (timeframes.h6.directionScore <= -25 || context.snapshot.priceChange6h <= -8) score += 25;
    if (timeframes.h24.directionScore < 40) score += 10;
    if (timeframes.h6.directionScore >= 40 || timeframes.h24.directionScore >= 70) score -= 25;
  } else {
    if (timeframes.h1.directionScore >= 0 && timeframes.h6.directionScore >= 0) score += 25;
    if (timeframes.h1.directionScore <= 0 && timeframes.h6.directionScore <= 0) score += 25;
  }

  if (label === "BULLISH_PULLBACK" && (context.structuralRegime === "BULLISH" || context.structuralRegime === "STRONG_BULLISH") && timeframes.h6.directionScore >= 25) score += 20;
  if (label === "BEARISH_RELIEF_BOUNCE" && (context.structuralRegime === "BEARISH" || context.structuralRegime === "STRONG_BEARISH") && timeframes.h6.directionScore <= -25) score += 20;
  if (label === "BEARISH_REVERSAL_ATTEMPT" && (context.trendChange === "IMPROVING" || context.trendChange === "IMPROVING_STRONGLY")) score += 15;
  if (label === "BULLISH_BREAKDOWN_ATTEMPT" && (context.trendChange === "WORSENING" || context.trendChange === "WORSENING_STRONGLY")) score += 15;

  return clamp(score, 0, 100);
}

function confirmationStatusFor(score: number): ConfirmationStatus {
  if (score >= 70) return "confirmed";
  if (score >= 50) return "watch";
  if (score >= 30) return "unconfirmed";
  return "contradicted";
}

function applyConfirmationGate(context: Context, label: PrimaryLabel, confirmation: ConfirmationResult): PrimaryLabel {
  if (!isMarketStructureLabel(label) || confirmation.confirmationStatus === "confirmed") return label;
  if (isConsolidation(context)) return "CONSOLIDATION";
  if (!context.dataQuality.hasMinimumActivity) return "LOW_ACTIVITY";
  return "UNKNOWN";
}

function directionBiasFor(label: PrimaryLabel): DirectionBias {
  if (["BULLISH_CONTINUATION_PUMP", "RANGE_BREAKOUT_ATTEMPT", "BEARISH_REVERSAL_ATTEMPT", "ACCUMULATION"].includes(label)) return "bullish";
  if (["BEARISH_CONTINUATION_DUMP", "RANGE_BREAKDOWN_ATTEMPT", "BULLISH_BREAKDOWN_ATTEMPT", "DISTRIBUTION"].includes(label)) return "bearish";
  return "neutral";
}

function resolveContextualLabel(context: Context): PrimaryLabel {
  const { snapshot, dataQuality, structuralRegime, lowerTimeframeTrigger, trendChange } = context;
  const criticalSafetyLabel = detectCriticalSafetyLabel(context);
  if (criticalSafetyLabel) return criticalSafetyLabel;
  if (dataQuality.score < 45) return "INSUFFICIENT_DATA";
  if (!dataQuality.hasMinimumActivity && Math.abs(snapshot.priceChange5m) <= 2 && Math.abs(snapshot.priceChange1h) <= 5) return "LOW_ACTIVITY";
  if (lowerTimeframeTrigger === "LOW_LIQUIDITY_PRICE_SPIKE") return "LOW_LIQUIDITY_PRICE_SPIKE";
  if (lowerTimeframeTrigger === "LOW_LIQUIDITY_SELL_OFF") return "LOW_LIQUIDITY_SELL_OFF";
  if (lowerTimeframeTrigger === "5M_LIQUIDITY_INCREASE") return "LIQUIDITY_ADDED";

  if (lowerTimeframeTrigger === "SHARP_5M_PUMP") {
    if (structuralRegime === "STRONG_BULLISH" || structuralRegime === "BULLISH") return "BULLISH_CONTINUATION_PUMP";
    if (structuralRegime === "BEARISH" || structuralRegime === "STRONG_BEARISH") {
      return trendChange === "IMPROVING" || trendChange === "IMPROVING_STRONGLY" ? "BEARISH_REVERSAL_ATTEMPT" : "BEARISH_RELIEF_BOUNCE";
    }
    return "RANGE_BREAKOUT_ATTEMPT";
  }

  if (lowerTimeframeTrigger === "SHARP_5M_DUMP") {
    if (structuralRegime === "STRONG_BEARISH" || structuralRegime === "BEARISH") return "BEARISH_CONTINUATION_DUMP";
    if (structuralRegime === "BULLISH" || structuralRegime === "STRONG_BULLISH") {
      return trendChange === "WORSENING" || trendChange === "WORSENING_STRONGLY" ? "BULLISH_BREAKDOWN_ATTEMPT" : "BULLISH_PULLBACK";
    }
    return "RANGE_BREAKDOWN_ATTEMPT";
  }

  if (isAccumulation(context)) return "ACCUMULATION";
  if (isDistribution(context)) return "DISTRIBUTION";
  if (isConsolidation(context)) return "CONSOLIDATION";
  return "UNKNOWN";
}

function detectCriticalSafetyLabel(context: Context): PrimaryLabel | null {
  const { snapshot, features } = context;
  const isThinPool = features.liquidityRegime === "LOW_LIQUIDITY" || features.liquidityRegime === "FRAGILE_LIQUIDITY";
  const isMeaningfulDrain = isMeaningfulLiquidityShock(snapshot.liquidityUsd, features.liquidityChangePercentage, features.liquidityChangeUsd) &&
    (features.liquidityChangeUsd ?? 0) < 0;

  if (isMeaningfulDrain) return "LIQUIDITY_DRAIN";
  if (isThinPool && snapshot.priceChange5m >= 8) return "LOW_LIQUIDITY_PRICE_SPIKE";
  if (isThinPool && snapshot.priceChange5m <= -8) return "LOW_LIQUIDITY_SELL_OFF";
  if (features.volumeToLiquidityRatio >= 1 && snapshot.priceChange5m >= 8) return "LOW_LIQUIDITY_PRICE_SPIKE";
  if (features.volumeToLiquidityRatio >= 1 && snapshot.priceChange5m <= -8) return "LOW_LIQUIDITY_SELL_OFF";
  return null;
}

function applyHysteresis(candidate: PrimaryLabel, context: Context): PrimaryLabel {
  const previous = context.previousClassification;
  if (!previous || candidate === previous.primaryLabel) return candidate;
  if (candidate === "LIQUIDITY_DRAIN") return candidate;
  const candidatePriority = LABEL_PRIORITY[candidate] ?? 0;
  const previousPriority = LABEL_PRIORITY[previous.primaryLabel] ?? 0;
  if (candidatePriority >= previousPriority + 10) return candidate;
  if (previous.eventStatus === "expired" || previous.eventStatus === "failed") return candidate;
  return candidate;
}

function calculateActiveRegime(context: Context, primaryLabel: PrimaryLabel): ActiveRegime {
  if (primaryLabel === "LIQUIDITY_DRAIN") return "DANGER";
  if (primaryLabel === "LOW_ACTIVITY" || primaryLabel === "INSUFFICIENT_DATA") return "LOW_ACTIVITY";
  if (primaryLabel === "BEARISH_RELIEF_BOUNCE") return "COUNTER_TREND_BOUNCE";
  if (primaryLabel === "BULLISH_PULLBACK") return "PULLBACK";
  if (primaryLabel === "BEARISH_REVERSAL_ATTEMPT") return "REVERSAL_ATTEMPT";
  if (primaryLabel === "BULLISH_BREAKDOWN_ATTEMPT") return "BREAKDOWN_ATTEMPT";
  if (primaryLabel === "RANGE_BREAKOUT_ATTEMPT") return "BREAKOUT_ATTEMPT";
  if (primaryLabel === "RANGE_BREAKDOWN_ATTEMPT") return "BREAKDOWN_ATTEMPT";
  if (context.timeframeAlignment.status === "aligned_bullish" || context.timeframeAlignment.status === "aligned_bearish") return "CONTINUATION";
  return "UNKNOWN";
}

function getSecondarySignals(context: Context): SignalLabel[] {
  const signals: SignalLabel[] = [];
  const { features, lowerTimeframeTrigger, structuralRegime } = context;
  if (lowerTimeframeTrigger !== "NONE") signals.push(triggerToSignal(lowerTimeframeTrigger));
  if (features.buyTxnDominance >= 0.58) signals.push("BUY_TXN_DOMINANCE");
  if (features.sellTxnDominance >= 0.58) signals.push("SELL_TXN_DOMINANCE");
  if (features.volumeSpikeScore >= 1.8) signals.push("VOLUME_SPIKE");
  if (features.volatilityScore >= 18) signals.push("HIGH_VOLATILITY");
  if (features.liquidityState === "increasing" || features.liquidityState === "sudden_increase") signals.push("LIQUIDITY_INCREASING");
  if (features.liquidityState === "decreasing" || features.liquidityState === "sudden_drop") signals.push("LIQUIDITY_DECREASING");
  if (features.liquidityState === "stable") signals.push("LIQUIDITY_STABLE");
  if (structuralRegime === "BEARISH" || structuralRegime === "STRONG_BEARISH") signals.push("HIGHER_TIMEFRAME_BEARISH");
  if (structuralRegime === "BULLISH" || structuralRegime === "STRONG_BULLISH") signals.push("HIGHER_TIMEFRAME_BULLISH");
  if (context.timeframeAlignment.conflictSeverity === "high") signals.push("TIMEFRAME_CONFLICT");
  return unique(signals);
}

function getContradictorySignals(context: Context, label: PrimaryLabel): SignalLabel[] {
  const contradictions: SignalLabel[] = [];
  const bullishLabels: PrimaryLabel[] = ["BULLISH_CONTINUATION_PUMP", "RANGE_BREAKOUT_ATTEMPT", "BEARISH_REVERSAL_ATTEMPT", "PUMP"];
  const bearishLabels: PrimaryLabel[] = ["BEARISH_CONTINUATION_DUMP", "RANGE_BREAKDOWN_ATTEMPT", "BULLISH_BREAKDOWN_ATTEMPT", "DUMP"];
  if (bullishLabels.includes(label) && context.features.sellTxnDominance >= 0.58) contradictions.push("SELL_TXN_DOMINANCE");
  if (bearishLabels.includes(label) && context.features.buyTxnDominance >= 0.58) contradictions.push("BUY_TXN_DOMINANCE");
  if ((label === "BULLISH_CONTINUATION_PUMP" || label === "RANGE_BREAKOUT_ATTEMPT") && (context.structuralRegime === "BEARISH" || context.structuralRegime === "STRONG_BEARISH")) contradictions.push("HIGHER_TIMEFRAME_BEARISH");
  if ((label === "BEARISH_CONTINUATION_DUMP" || label === "RANGE_BREAKDOWN_ATTEMPT") && (context.structuralRegime === "BULLISH" || context.structuralRegime === "STRONG_BULLISH")) contradictions.push("HIGHER_TIMEFRAME_BULLISH");
  if (context.timeframeAlignment.conflictSeverity === "high") contradictions.push("TIMEFRAME_CONFLICT");
  return unique(contradictions);
}

function calculateConfidence(context: Context, label: PrimaryLabel, contradictions: SignalLabel[], signals: SignalLabel[]): ConfidenceBreakdown {
  const triggerConfidence = calculateTriggerConfidence(context);
  const regimeConfidence = clamp(Math.round(Math.abs(structuralScoreFor(context.timeframes, context.regimeWeights))), 25, 96);
  let interpretationConfidence = Math.round((triggerConfidence + regimeConfidence) / 2);
  if (context.timeframeAlignment.status.startsWith("aligned")) interpretationConfidence += 8;
  if (context.features.volumeQualityScore >= 61) interpretationConfidence += 6;
  if (context.features.liquidityRegime === "HEALTHY_LIQUIDITY" || context.features.liquidityRegime === "LIQUIDITY_EXPANDING") interpretationConfidence += 5;
  if (context.pairReliability?.tier === "low") interpretationConfidence -= 8;
  interpretationConfidence -= contradictions.length * 8;
  if (label === "LOW_LIQUIDITY_PRICE_SPIKE" || label === "LOW_LIQUIDITY_SELL_OFF") interpretationConfidence -= 8;
  const dataConfidence = context.dataQuality.score;
  const finalConfidence = clamp(Math.round(triggerConfidence * 0.25 + regimeConfidence * 0.25 + interpretationConfidence * 0.3 + dataConfidence * 0.2 + signals.length), 20, 96);
  return {
    triggerConfidence,
    regimeConfidence,
    interpretationConfidence: clamp(interpretationConfidence, 20, 96),
    dataConfidence,
    finalConfidence
  };
}

function calculateRisk(context: Context, label: PrimaryLabel, contradictions: SignalLabel[]): RiskAssessment {
  const reasons: string[] = [];
  let score = 20;
  if (["LIQUIDITY_DRAIN", "LOW_LIQUIDITY_PRICE_SPIKE", "LOW_LIQUIDITY_SELL_OFF"].includes(label)) {
    score += 35;
    reasons.push("Liquidity makes the move unreliable or dangerous.");
  }
  if (label === "LIQUIDITY_DRAIN" && (context.snapshot.priceChange5m <= -12 || (context.features.liquidityChangeUsd ?? 0) <= -10_000)) {
    score += 18;
    reasons.push("Liquidity drained by a meaningful amount during a sharp move.");
  }
  if (context.structuralRegime === "STRONG_BEARISH" && context.lowerTimeframeTrigger === "SHARP_5M_PUMP") {
    score += 22;
    reasons.push("The 5m pump is counter-trend inside a strong bearish structure.");
  }
  if (context.structuralRegime === "STRONG_BULLISH" && context.lowerTimeframeTrigger === "SHARP_5M_DUMP") {
    score += 14;
    reasons.push("The 5m dump conflicts with a strong bullish structure.");
  }
  if (context.features.volumeToLiquidityRatio >= 0.5) {
    score += 15;
    reasons.push("5m volume is high compared with available liquidity.");
  }
  if (context.features.volatilityScore >= 25) {
    score += 14;
    reasons.push("Recent volatility is extreme.");
  }
  if (contradictions.length > 0) {
    score += 10;
    reasons.push("Important signals contradict the final interpretation.");
  }
  if (context.dataQuality.score < 60) {
    score += 10;
    reasons.push("Data quality is weak.");
  }
  if (context.pairReliability?.tier === "low") {
    score += 8;
    reasons.push("The selected DexScreener pair has weak reliability.");
  }
  return { score: clamp(score, 0, 100), level: riskLevelFor(score), reasons: reasons.length ? reasons : ["No major risk driver detected."] };
}

function calculateManipulationRisk(context: Context): ManipulationRisk {
  const reasons: string[] = [];
  let score = 0;
  if (Math.abs(context.snapshot.priceChange5m) >= 25) {
    score += 24;
    reasons.push("Extreme 5m price move.");
  }
  if (context.features.volumeSpikeScore >= 3) {
    score += 16;
    reasons.push("Extreme short-term volume spike.");
  }
  if (context.features.liquidityRegime === "LOW_LIQUIDITY" || context.features.liquidityRegime === "FRAGILE_LIQUIDITY") {
    score += 24;
    reasons.push("Liquidity is low or fragile.");
  }
  if (context.features.volumeToLiquidityRatio >= 1) {
    score += 18;
    reasons.push("Volume-to-liquidity ratio is extreme.");
  }
  if (context.timeframeAlignment.conflictSeverity === "high") {
    score += 12;
    reasons.push("Lower timeframe conflicts heavily with the larger structure.");
  }
  return { score: clamp(score, 0, 100), level: riskLevelFor(score), reasons };
}

function calculateEventStatus(previous: FinalClassification | null, label: PrimaryLabel, confidence: number): EventStatus {
  if (!previous || previous.primaryLabel !== label) return "new";
  if (confidence >= previous.finalConfidence + 8) return "strengthening";
  if (confidence <= previous.finalConfidence - 8) return "weakening";
  if (confidence >= 85) return "confirmed";
  return "active";
}

function buildEvidence(context: Context, label: PrimaryLabel, candidateLabel: PrimaryLabel, confirmation: ConfirmationResult): string[] {
  const { snapshot, features, structuralRegime, lowerTimeframeTrigger, timeframes } = context;
  const opening = label === candidateLabel
    ? `${displayLabelFor(label)} selected from ${lowerTimeframeTrigger.replaceAll("_", " ")} inside ${structuralRegime.replaceAll("_", " ")} structure.`
    : `${lowerTimeframeTrigger.replaceAll("_", " ")} flagged ${displayLabelFor(candidateLabel)}. 1h/6h confirmation is ${confirmation.confirmationStatus}; final label is ${displayLabelFor(label)}.`;
  return unique([
    opening,
    `Confirmation score is ${confirmation.confirmationScore}/100; decision horizon is ${confirmation.eventHorizon}.`,
    `5m price change is ${formatPercent(snapshot.priceChange5m)}; 1h is ${formatPercent(snapshot.priceChange1h)}; 6h is ${formatPercent(snapshot.priceChange6h)}; 24h is ${formatPercent(snapshot.priceChange24h)}.`,
    `5m direction score is ${timeframes.m5.directionScore}; structural direction is ${structuralRegime.replaceAll("_", " ")}.`,
    `Volume quality is ${features.volumeQualityLevel} (${features.volumeQualityScore}/100).`,
    `Liquidity regime is ${features.liquidityRegime.replaceAll("_", " ")}.`
  ]);
}

function buildWarnings(context: Context, label: PrimaryLabel, candidateLabel: PrimaryLabel, confirmation: ConfirmationResult, contradictions: SignalLabel[], risk: RiskAssessment, manipulationRisk: ManipulationRisk): string[] {
  const warnings: string[] = [...context.dataQuality.warnings];
  if (label !== candidateLabel && confirmation.classificationBasis === "short_term_watch") warnings.push(`${displayLabelFor(candidateLabel)} needs stronger 1h/6h confirmation before it can become an event.`);
  if (label === "BEARISH_RELIEF_BOUNCE") warnings.push("The 5m move is bullish, but higher timeframes remain bearish.");
  if (label === "BULLISH_PULLBACK") warnings.push("The 5m move is bearish, but higher timeframes remain bullish.");
  if (label === "BEARISH_REVERSAL_ATTEMPT") warnings.push("Reversal is not confirmed until higher timeframes improve.");
  if (label === "LOW_LIQUIDITY_PRICE_SPIKE") warnings.push("Price moved sharply, but liquidity and activity are too thin for a clean pump label.");
  if (context.pairReliability?.tier === "low") warnings.push("The selected DexScreener pair has weak reliability.");
  if (contradictions.length > 0) warnings.push(`Contradictory signals detected: ${contradictions.join(", ")}.`);
  if (risk.level === "high" || risk.level === "critical") warnings.push(...risk.reasons);
  if (manipulationRisk.level === "high" || manipulationRisk.level === "critical") warnings.push(...manipulationRisk.reasons);
  return unique(warnings);
}

function buildDetectorScores(context: Context, label: PrimaryLabel, confidence: ConfidenceBreakdown, risk: RiskLevel): FinalClassification["detectorScores"] {
  return [
    { label, category: "event", score: confidence.finalConfidence, confidence: confidence.finalConfidence, risk },
    { label: triggerToSignal(context.lowerTimeframeTrigger), category: "signal", score: confidence.triggerConfidence, confidence: confidence.triggerConfidence, risk: "low" },
    { label: context.structuralRegime.includes("BEARISH") ? "HIGHER_TIMEFRAME_BEARISH" : "HIGHER_TIMEFRAME_BULLISH", category: "signal", score: confidence.regimeConfidence, confidence: confidence.regimeConfidence, risk: "low" }
  ];
}

function isAccumulation(context: Context): boolean {
  const { snapshot, features, dataQuality } = context;
  return dataQuality.hasEnoughHistory &&
    dataQuality.hasMinimumActivity &&
    snapshot.priceChange5m >= -3 &&
    snapshot.priceChange5m <= 8 &&
    snapshot.priceChange1h >= 1 &&
    snapshot.priceChange1h <= 15 &&
    snapshot.priceChange6h >= 1 &&
    features.consecutiveBuyDominantSnapshots >= 3 &&
    features.volatilityScore < 18 &&
    context.structuralRegime !== "STRONG_BEARISH";
}

function isDistribution(context: Context): boolean {
  const { snapshot, features, dataQuality } = context;
  return dataQuality.hasEnoughHistory &&
    dataQuality.hasMinimumActivity &&
    snapshot.priceChange5m >= -8 &&
    snapshot.priceChange5m <= 3 &&
    snapshot.priceChange1h >= -15 &&
    snapshot.priceChange1h <= -1 &&
    snapshot.priceChange6h <= -1 &&
    features.consecutiveSellDominantSnapshots >= 3 &&
    context.structuralRegime !== "STRONG_BULLISH";
}

function isConsolidation(context: Context): boolean {
  const { snapshot, features, dataQuality } = context;
  return dataQuality.hasEnoughHistory &&
    dataQuality.hasMinimumActivity &&
    Math.abs(snapshot.priceChange5m) <= 3 &&
    Math.abs(snapshot.priceChange1h) <= 8 &&
    features.pressureState === "balanced" &&
    features.liquidityState === "stable";
}

function detectDominantTimeframe(timeframes: Context["timeframes"], structuralRegime: StructuralRegime): { timeframe: DominantTimeframe; reason: string } {
  const entries: Array<[DominantTimeframe, TimeframeAnalysis]> = [["5m", timeframes.m5], ["1h", timeframes.h1], ["6h", timeframes.h6], ["24h", timeframes.h24]];
  const [timeframe, analysis] = entries.sort((a, b) => Math.abs(b[1].directionScore) - Math.abs(a[1].directionScore))[0];
  if ((structuralRegime === "STRONG_BEARISH" || structuralRegime === "STRONG_BULLISH") && Math.abs(timeframes.h6.directionScore) >= 70) {
    return { timeframe: "6h", reason: `6h structure remains ${timeframes.h6.direction.replaceAll("_", " ")}.` };
  }
  return { timeframe, reason: `${timeframe} has the strongest direction score (${analysis.directionScore}).` };
}

function calculateTriggerConfidence(context: Context): number {
  if (context.lowerTimeframeTrigger === "NONE") return 35;
  if (context.lowerTimeframeTrigger === "LOW_ACTIVITY_MOVE") return 45;
  let score = 65;
  if (Math.abs(context.snapshot.priceChange5m) >= 12) score += 12;
  if (context.features.volumeQualityScore >= 61) score += 12;
  if (context.dataQuality.hasMinimumActivity) score += 6;
  if (context.features.liquidityRegime === "LIQUIDITY_SHOCK") score += 8;
  return clamp(score, 20, 96);
}

function baseline(history: TokenSnapshot[], field: keyof Pick<TokenSnapshot, "priceChange5m" | "priceChange1h" | "priceChange6h" | "priceChange24h">): number {
  const values = history.slice(0, 48).map((snapshot) => Math.abs(snapshot[field])).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) return field === "priceChange5m" ? 4 : field === "priceChange1h" ? 8 : 15;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getVolumeConfirmation(priceChange: number, features: TokenFeatures): TimeframeAnalysis["volumeConfirmation"] {
  if (features.volumeQualityScore >= 61 && Math.abs(priceChange) >= 5) return "confirming";
  if (features.volumeQualityScore <= 30 && Math.abs(priceChange) >= 5) return "weak";
  if (features.volumeSpikeScore >= 1.8 && Math.abs(priceChange) < 3) return "divergent";
  return "unknown";
}

function getLiquidityConfirmation(features: TokenFeatures): TimeframeAnalysis["liquidityConfirmation"] {
  if (features.liquidityRegime === "HEALTHY_LIQUIDITY" || features.liquidityRegime === "LIQUIDITY_EXPANDING") return "supportive";
  if (features.liquidityRegime === "LIQUIDITY_SHOCK" || features.liquidityRegime === "FRAGILE_LIQUIDITY") return "dangerous";
  if (features.liquidityRegime === "LOW_LIQUIDITY") return "unknown";
  return "neutral";
}

function getTimeframeReliability(priceChange: number, features: TokenFeatures): number {
  let score = 70;
  if (features.volumeQualityScore >= 61) score += 10;
  if (features.liquidityRegime === "FRAGILE_LIQUIDITY" || features.liquidityRegime === "LOW_LIQUIDITY") score -= 25;
  if (features.liquidityRegime === "LIQUIDITY_SHOCK") score -= 20;
  if (Math.abs(priceChange) < 1) score -= 10;
  return clamp(score, 0, 100);
}

function conflictSeverity(conflict: number): TimeframeAlignment["conflictSeverity"] {
  if (conflict >= 120) return "high";
  if (conflict >= 80) return "medium";
  if (conflict >= 40) return "low";
  return "none";
}

function toBehaviorLabel(label: PrimaryLabel): BehaviorLabel {
  return label;
}
