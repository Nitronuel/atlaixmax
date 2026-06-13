export type ChainId = string;

export type BehaviorLabel =
  | "BULLISH_CONTINUATION_PUMP"
  | "BEARISH_CONTINUATION_DUMP"
  | "BEARISH_RELIEF_BOUNCE"
  | "BULLISH_PULLBACK"
  | "BEARISH_REVERSAL_ATTEMPT"
  | "BULLISH_BREAKDOWN_ATTEMPT"
  | "RANGE_BREAKOUT_ATTEMPT"
  | "RANGE_BREAKDOWN_ATTEMPT"
  | "LOW_LIQUIDITY_PRICE_SPIKE"
  | "LOW_LIQUIDITY_SELL_OFF"
  | "ACCUMULATION"
  | "DISTRIBUTION"
  | "PUMP"
  | "DUMP"
  | "LIQUIDITY_DRAIN"
  | "LIQUIDITY_ADDED"
  | "BUY_RECOVERY"
  | "SELL_OFF"
  | "CONSOLIDATION"
  | "LOW_ACTIVITY"
  | "INSUFFICIENT_DATA"
  | "UNKNOWN";

export type PrimaryLabel =
  | "BULLISH_CONTINUATION_PUMP"
  | "BEARISH_CONTINUATION_DUMP"
  | "BEARISH_RELIEF_BOUNCE"
  | "BULLISH_PULLBACK"
  | "BEARISH_REVERSAL_ATTEMPT"
  | "BULLISH_BREAKDOWN_ATTEMPT"
  | "RANGE_BREAKOUT_ATTEMPT"
  | "RANGE_BREAKDOWN_ATTEMPT"
  | "LOW_LIQUIDITY_PRICE_SPIKE"
  | "LOW_LIQUIDITY_SELL_OFF"
  | "LIQUIDITY_DRAIN"
  | "LIQUIDITY_ADDED"
  | "PUMP"
  | "DUMP"
  | "BUY_RECOVERY"
  | "SELL_OFF"
  | "ACCUMULATION"
  | "DISTRIBUTION"
  | "CONSOLIDATION"
  | "LOW_ACTIVITY"
  | "INSUFFICIENT_DATA"
  | "UNKNOWN";

export type SignalLabel =
  | "SHARP_5M_PUMP"
  | "SHARP_5M_DUMP"
  | "5M_VOLUME_SPIKE"
  | "5M_LIQUIDITY_DROP"
  | "5M_LIQUIDITY_INCREASE"
  | "HIGHER_TIMEFRAME_BULLISH"
  | "HIGHER_TIMEFRAME_BEARISH"
  | "TIMEFRAME_CONFLICT"
  | "BUY_TXN_DOMINANCE"
  | "SELL_TXN_DOMINANCE"
  | "VOLUME_SPIKE"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "LIQUIDITY_INCREASING"
  | "LIQUIDITY_DECREASING"
  | "LIQUIDITY_STABLE"
  | "PRICE_MOMENTUM_UP"
  | "PRICE_MOMENTUM_DOWN"
  | "WEAK_ACTIVITY"
  | "LOW_LIQUIDITY"
  | "HIGH_VOLUME_TO_LIQUIDITY_RATIO";

export type DetectorLabel = PrimaryLabel | SignalLabel;

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AlertPriority = "none" | "low" | "medium" | "high" | "critical";
export type ScanTier = "hot" | "warm" | "cold" | "dormant";
export type MarketPhase = "EXPANSION" | "CONTRACTION" | "ACCUMULATION" | "DISTRIBUTION" | "STABLE" | "LOW_ACTIVITY" | "DANGER" | "UNKNOWN";
export type StructuralRegime = "STRONG_BULLISH" | "BULLISH" | "SIDEWAYS" | "BEARISH" | "STRONG_BEARISH" | "MIXED";
export type ActiveRegime = "CONTINUATION" | "COUNTER_TREND_BOUNCE" | "PULLBACK" | "BREAKOUT_ATTEMPT" | "BREAKDOWN_ATTEMPT" | "REVERSAL_ATTEMPT" | "DANGER" | "LOW_ACTIVITY" | "UNKNOWN";
export type LowerTimeframeTrigger =
  | "SHARP_5M_PUMP"
  | "SHARP_5M_DUMP"
  | "5M_VOLUME_SPIKE"
  | "5M_BUY_TXN_DOMINANCE"
  | "5M_SELL_TXN_DOMINANCE"
  | "5M_LIQUIDITY_DROP"
  | "5M_LIQUIDITY_INCREASE"
  | "LOW_LIQUIDITY_PRICE_SPIKE"
  | "LOW_LIQUIDITY_SELL_OFF"
  | "LOW_ACTIVITY_MOVE"
  | "NONE";
export type TimeframeAlignmentStatus = "aligned_bullish" | "aligned_bearish" | "counter_trend_bullish" | "counter_trend_bearish" | "mixed" | "transitioning";
export type TrendChange = "IMPROVING_STRONGLY" | "IMPROVING" | "UNCHANGED" | "WORSENING" | "WORSENING_STRONGLY";
export type EventStatus = "new" | "active" | "strengthening" | "weakening" | "confirmed" | "failed" | "expired";
export type DominantTimeframe = "5m" | "1h" | "6h" | "24h" | "mixed";
export type EventHorizon = "5m" | "1h" | "6h" | "24h" | "mixed";
export type ConfirmationStatus = "unconfirmed" | "watch" | "confirmed" | "contradicted";
export type ClassificationBasis = "safety_override" | "higher_timeframe_confirmed" | "short_term_watch" | "quiet_context";
export type LiquidityRegime = "HEALTHY_LIQUIDITY" | "LOW_LIQUIDITY" | "FRAGILE_LIQUIDITY" | "LIQUIDITY_EXPANDING" | "LIQUIDITY_DRAINING" | "LIQUIDITY_SHOCK";
export type VolumeQualityLevel = "poor" | "moderate" | "good" | "strong";
export type PairReliabilityTier = "high" | "medium" | "low";

export interface PairReliability {
  score: number;
  tier: PairReliabilityTier;
  reasons: string[];
}

export interface TokenSchedulePatch {
  scanTier: ScanTier;
  nextDetectionCheckAt: string;
  detectionPriorityScore: number;
  failedHydrationCount?: number;
  lastPrimaryLabel?: PrimaryLabel | null;
  lastRiskLevel?: RiskLevel | null;
  lastEventStatus?: EventStatus | null;
  consecutiveQuietCount?: number;
}

export interface Token {
  tokenId: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenAddress: string;
  chain: ChainId;
  pairAddress: string;
  dexId: string | null;
  pairUrl: string | null;
}

export interface TokenSnapshot {
  tokenId: string;
  timestamp: string;
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume5m: number;
  volume1h: number;
  volume6h: number;
  volume24h: number;
  buys5m: number;
  sells5m: number;
  traders5m: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  pairCreatedAt?: number | null;
  pairReliability?: PairReliability | null;
  raw: unknown;
}

export interface TokenFeatures {
  tokenId: string;
  timestamp: string;
  totalTxns5m: number;
  buySellRatio: number;
  buyTxnDominance: number;
  sellTxnDominance: number;
  netTxnPressure: number;
  liquidityChangePercentage: number | null;
  liquidityChangeUsd: number | null;
  volumeToLiquidityRatio: number;
  volumeSpikeScore: number;
  volumeSpikePersistedSnapshots: number;
  volumeQualityScore: number;
  volumeQualityLevel: VolumeQualityLevel;
  liquidityRegime: LiquidityRegime;
  priceMomentumScore: number;
  volatilityScore: number;
  consecutiveGreenSnapshots: number;
  consecutiveRedSnapshots: number;
  consecutiveBuyDominantSnapshots: number;
  consecutiveSellDominantSnapshots: number;
  trendDirection: "uptrend" | "downtrend" | "sideways" | "reversal" | "unstable";
  liquidityState: "stable" | "increasing" | "decreasing" | "sudden_drop" | "sudden_increase" | "unknown";
  pressureState: "strong_buy_pressure" | "strong_sell_pressure" | "balanced" | "weak_activity";
}

export interface DataQuality {
  score: number;
  historySnapshots: number;
  missingFields: string[];
  warnings: string[];
  hasMinimumActivity: boolean;
  hasEnoughHistory: boolean;
  hasReliableLiquidity: boolean;
}

export interface RuleClassification {
  label: BehaviorLabel;
  confidence: number;
  riskLevel: RiskLevel;
  reason: string;
}

export interface DetectorResult {
  label: DetectorLabel;
  category: "event" | "signal" | "risk";
  score: number;
  confidence: number;
  risk: RiskLevel;
  evidence: string[];
  warnings: string[];
  priority: number;
}

export interface TimeframeAnalysis {
  timeframe: "5m" | "1h" | "6h" | "24h";
  rawPriceChange: number;
  deoverlappedPriceChange?: number | null;
  normalizedMove: number;
  direction: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish";
  directionScore: number;
  momentumScore: number;
  volumeConfirmation: "confirming" | "weak" | "divergent" | "unknown";
  liquidityConfirmation: "supportive" | "dangerous" | "neutral" | "unknown";
  reliability: number;
}

export interface TimeframeAlignment {
  status: TimeframeAlignmentStatus;
  score: number;
  conflictSeverity: "none" | "low" | "medium" | "high";
}

export interface ConfidenceBreakdown {
  triggerConfidence: number;
  regimeConfidence: number;
  interpretationConfidence: number;
  dataConfidence: number;
  finalConfidence: number;
}

export interface RiskAssessment {
  level: RiskLevel;
  score: number;
  reasons: string[];
}

export interface ManipulationRisk {
  level: RiskLevel;
  score: number;
  reasons: string[];
}

export interface FinalClassification {
  tokenId: string;
  timestamp: string;
  ruleLabel: BehaviorLabel;
  ruleConfidence: number;
  finalLabel: BehaviorLabel;
  finalConfidence: number;
  riskLevel: RiskLevel;
  reason: string;
  primaryLabel: PrimaryLabel;
  displayLabel: string;
  marketPhase: MarketPhase;
  structuralRegime: StructuralRegime;
  activeRegime: ActiveRegime;
  dominantTimeframe: DominantTimeframe;
  dominantReason: string;
  eventHorizon: EventHorizon;
  confirmationStatus: ConfirmationStatus;
  confirmationScore: number;
  classificationBasis: ClassificationBasis;
  lowerTimeframeTrigger: LowerTimeframeTrigger;
  timeframeAlignment: TimeframeAlignment;
  trendChange: TrendChange;
  eventStatus: EventStatus;
  confidence: ConfidenceBreakdown;
  risk: RiskAssessment;
  manipulationRisk: ManipulationRisk;
  timeframes: Record<"m5" | "h1" | "h6" | "h24", TimeframeAnalysis>;
  liquidityRegime: LiquidityRegime;
  volumeQuality: {
    score: number;
    level: VolumeQualityLevel;
  };
  alertPriority: AlertPriority;
  secondarySignals: SignalLabel[];
  contradictorySignals: SignalLabel[];
  warnings: string[];
  evidence: string[];
  detectorScores: Array<Pick<DetectorResult, "label" | "category" | "score" | "confidence" | "risk">>;
  dataQuality: DataQuality;
  ruleVersion: string;
  tokenAgeMinutes?: number | null;
  regimeWeights?: Record<"m5" | "h1" | "h6" | "h24", number>;
  pairReliability?: PairReliability | null;
}

export interface Alert {
  tokenId: string;
  timestamp: string;
  alertType: BehaviorLabel;
  severity: RiskLevel;
  message: string;
  status: "open";
  stateKey: string;
}

export interface TokenRecord {
  token: Token;
  snapshot: TokenSnapshot;
}

export interface Store {
  getRecentSnapshots(tokenId: string, limit: number): Promise<TokenSnapshot[]>;
  getLatestClassification(tokenId: string): Promise<FinalClassification | null>;
  upsertToken(token: Token, snapshot?: TokenSnapshot, schedule?: TokenSchedulePatch): Promise<void>;
  saveSnapshot(snapshot: TokenSnapshot): Promise<void>;
  saveFeatures(features: TokenFeatures): Promise<void>;
  saveClassification(classification: FinalClassification): Promise<string>;
  saveAlert(alert: Alert): Promise<boolean>;
}
