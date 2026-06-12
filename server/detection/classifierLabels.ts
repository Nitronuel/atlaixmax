import type { AlertPriority, MarketPhase, PrimaryLabel, RiskLevel } from "./types";

export const LABEL_PRIORITY: Record<PrimaryLabel, number> = {
  LIQUIDITY_DRAIN: 100,
  LOW_LIQUIDITY_PRICE_SPIKE: 92,
  LOW_LIQUIDITY_SELL_OFF: 90,
  BEARISH_CONTINUATION_DUMP: 84,
  BULLISH_CONTINUATION_PUMP: 82,
  BEARISH_RELIEF_BOUNCE: 76,
  BULLISH_PULLBACK: 74,
  BEARISH_REVERSAL_ATTEMPT: 72,
  BULLISH_BREAKDOWN_ATTEMPT: 72,
  RANGE_BREAKOUT_ATTEMPT: 65,
  RANGE_BREAKDOWN_ATTEMPT: 65,
  LIQUIDITY_ADDED: 60,
  PUMP: 58,
  DUMP: 58,
  BUY_RECOVERY: 56,
  SELL_OFF: 56,
  ACCUMULATION: 50,
  DISTRIBUTION: 50,
  CONSOLIDATION: 35,
  LOW_ACTIVITY: 25,
  INSUFFICIENT_DATA: 20,
  UNKNOWN: 0
};

export function displayLabelFor(label: PrimaryLabel): string {
  const labels: Record<PrimaryLabel, string> = {
    BULLISH_CONTINUATION_PUMP: "Bullish Continuation",
    BEARISH_CONTINUATION_DUMP: "Bearish Continuation",
    BEARISH_RELIEF_BOUNCE: "Short-Term Bounce in Bearish Trend",
    BULLISH_PULLBACK: "Pullback in Bullish Trend",
    BEARISH_REVERSAL_ATTEMPT: "Possible Bullish Reversal Attempt",
    BULLISH_BREAKDOWN_ATTEMPT: "Possible Bearish Breakdown Attempt",
    RANGE_BREAKOUT_ATTEMPT: "Range Breakout Attempt",
    RANGE_BREAKDOWN_ATTEMPT: "Range Breakdown Attempt",
    LOW_LIQUIDITY_PRICE_SPIKE: "Low-Liquidity Price Spike",
    LOW_LIQUIDITY_SELL_OFF: "Low-Liquidity Sell-Off",
    LIQUIDITY_DRAIN: "Liquidity Drain",
    LIQUIDITY_ADDED: "Liquidity Added",
    PUMP: "Pump",
    DUMP: "Dump",
    BUY_RECOVERY: "Buy Recovery",
    SELL_OFF: "Sell-Off",
    ACCUMULATION: "Accumulation",
    DISTRIBUTION: "Distribution",
    CONSOLIDATION: "Consolidation",
    LOW_ACTIVITY: "Low Activity",
    INSUFFICIENT_DATA: "Insufficient Data",
    UNKNOWN: "Unknown"
  };
  return labels[label];
}

export function resolveMarketPhase(label: PrimaryLabel): MarketPhase {
  if (label === "BULLISH_CONTINUATION_PUMP" || label === "BEARISH_REVERSAL_ATTEMPT" || label === "RANGE_BREAKOUT_ATTEMPT" || label === "LIQUIDITY_ADDED") return "EXPANSION";
  if (label === "BEARISH_CONTINUATION_DUMP" || label === "BULLISH_BREAKDOWN_ATTEMPT" || label === "RANGE_BREAKDOWN_ATTEMPT" || label === "BULLISH_PULLBACK") return "CONTRACTION";
  if (label === "ACCUMULATION") return "ACCUMULATION";
  if (label === "DISTRIBUTION") return "DISTRIBUTION";
  if (label === "CONSOLIDATION") return "STABLE";
  if (label === "LOW_ACTIVITY" || label === "INSUFFICIENT_DATA") return "LOW_ACTIVITY";
  if (label === "LIQUIDITY_DRAIN" || label === "LOW_LIQUIDITY_PRICE_SPIKE" || label === "LOW_LIQUIDITY_SELL_OFF") return "DANGER";
  return "UNKNOWN";
}

export function resolveAlertPriority(label: PrimaryLabel, risk: RiskLevel, confidence: number): AlertPriority {
  if (risk === "critical" && confidence >= 65) return "critical";
  if (["LIQUIDITY_DRAIN", "LOW_LIQUIDITY_PRICE_SPIKE", "LOW_LIQUIDITY_SELL_OFF"].includes(label)) return "high";
  if (["BEARISH_CONTINUATION_DUMP", "BULLISH_CONTINUATION_PUMP", "BEARISH_RELIEF_BOUNCE", "BULLISH_BREAKDOWN_ATTEMPT"].includes(label) && confidence >= 65) return "high";
  if (["BEARISH_REVERSAL_ATTEMPT", "BULLISH_PULLBACK", "RANGE_BREAKOUT_ATTEMPT", "RANGE_BREAKDOWN_ATTEMPT", "ACCUMULATION", "DISTRIBUTION"].includes(label) && confidence >= 60) return "medium";
  if (label === "LOW_ACTIVITY" || label === "UNKNOWN" || label === "INSUFFICIENT_DATA") return "none";
  return "low";
}
