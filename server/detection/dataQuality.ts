import type { DataQuality, TokenFeatures, TokenSnapshot } from "./types";

export function calculateDataQuality(snapshot: TokenSnapshot, features: TokenFeatures, history: TokenSnapshot[]): DataQuality {
  const missingFields = [
    ["priceUsd", snapshot.priceUsd],
    ["liquidityUsd", snapshot.liquidityUsd],
    ["marketCap", snapshot.marketCap]
  ]
    .filter(([, value]) => value === null || value === undefined)
    .map(([field]) => String(field));

  const warnings: string[] = [];
  const hasMinimumActivity = features.totalTxns5m >= 10 && snapshot.volume5m >= 500;
  const hasEnoughHistory = history.length >= 3;
  const hasReliableLiquidity = (snapshot.liquidityUsd ?? 0) >= 1_000;

  let score = 100;
  score -= Math.min(35, missingFields.length * 12);
  if (!hasMinimumActivity) {
    score -= 25;
    warnings.push("Activity is below the minimum threshold.");
  }
  if (!hasEnoughHistory) {
    score -= 15;
    warnings.push("Historical snapshot depth is limited.");
  }
  if (!hasReliableLiquidity) {
    score -= 20;
    warnings.push("Liquidity is low enough to exaggerate movement.");
  }
  if (!Number.isFinite(snapshot.priceChange5m) || !Number.isFinite(snapshot.volume5m)) score -= 20;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    historySnapshots: history.length,
    missingFields,
    warnings,
    hasMinimumActivity,
    hasEnoughHistory,
    hasReliableLiquidity
  };
}
