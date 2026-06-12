import type { TokenFeatures, TokenSnapshot } from "./types";

export function calculateFeatures(current: TokenSnapshot, history: TokenSnapshot[]): TokenFeatures {
  const previous = history[0] ?? null;
  const averageVolume5m = average(history.slice(0, 12).map((snapshot) => snapshot.volume5m));
  const liquidityChangePercentage = percentageChange(previous?.liquidityUsd ?? null, current.liquidityUsd);
  const liquidityChangeUsd = current.liquidityUsd !== null && previous?.liquidityUsd != null
    ? current.liquidityUsd - previous.liquidityUsd
    : null;
  const totalTxns5m = current.buys5m + current.sells5m;
  const buySellRatio = (current.buys5m + 1) / (current.sells5m + 1);
  const buyTxnDominance = totalTxns5m > 0 ? current.buys5m / totalTxns5m : 0;
  const sellTxnDominance = totalTxns5m > 0 ? current.sells5m / totalTxns5m : 0;
  const netTxnPressure = totalTxns5m > 0 ? (current.buys5m - current.sells5m) / totalTxns5m : 0;
  const volumeToLiquidityRatio = current.liquidityUsd && current.liquidityUsd > 0 ? current.volume5m / current.liquidityUsd : 0;
  const volumeSpikeScore = averageVolume5m > 0 ? current.volume5m / averageVolume5m : 1;
  const volumeSpikePersistedSnapshots = countConsecutive(
    history,
    (snapshot) => averageVolume5m > 0 && snapshot.volume5m / averageVolume5m >= 1.8,
    volumeSpikeScore >= 1.8
  );
  const liquidityRegime = getLiquidityRegime(current, liquidityChangePercentage, liquidityChangeUsd, volumeToLiquidityRatio);
  const volumeQualityScore = getVolumeQualityScore(current, volumeSpikeScore, volumeSpikePersistedSnapshots, volumeToLiquidityRatio, liquidityRegime);
  const priceMomentumScore = current.priceChange5m * 0.2 + current.priceChange1h * 0.35 + current.priceChange6h * 0.3 + current.priceChange24h * 0.15;
  const volatilityScore = average([
    Math.abs(current.priceChange5m),
    Math.abs(current.priceChange1h),
    Math.abs(current.priceChange6h)
  ]);

  return {
    tokenId: current.tokenId,
    timestamp: current.timestamp,
    totalTxns5m,
    buySellRatio,
    buyTxnDominance,
    sellTxnDominance,
    netTxnPressure,
    liquidityChangePercentage,
    liquidityChangeUsd,
    volumeToLiquidityRatio,
    volumeSpikeScore,
    volumeSpikePersistedSnapshots,
    volumeQualityScore,
    volumeQualityLevel: getVolumeQualityLevel(volumeQualityScore),
    liquidityRegime,
    priceMomentumScore,
    volatilityScore,
    consecutiveGreenSnapshots: countConsecutive(history, (snapshot) => snapshot.priceChange5m > 0, current.priceChange5m > 0),
    consecutiveRedSnapshots: countConsecutive(history, (snapshot) => snapshot.priceChange5m < 0, current.priceChange5m < 0),
    consecutiveBuyDominantSnapshots: countConsecutive(
      history,
      (snapshot) => dominance(snapshot.buys5m, snapshot.sells5m) >= 0.58,
      buyTxnDominance >= 0.58
    ),
    consecutiveSellDominantSnapshots: countConsecutive(
      history,
      (snapshot) => dominance(snapshot.sells5m, snapshot.buys5m) >= 0.58,
      sellTxnDominance >= 0.58
    ),
    trendDirection: getTrendDirection(current, priceMomentumScore, volatilityScore),
    liquidityState: getLiquidityState(liquidityChangePercentage),
    pressureState: getPressureState(current, buySellRatio)
  };
}

function getLiquidityRegime(
  snapshot: TokenSnapshot,
  changePercent: number | null,
  changeUsd: number | null,
  volumeToLiquidityRatio: number
): TokenFeatures["liquidityRegime"] {
  const liquidity = snapshot.liquidityUsd ?? 0;
  if (changePercent !== null && changeUsd !== null && Math.abs(changePercent) >= 25 && Math.abs(changeUsd) >= 1_000) return "LIQUIDITY_SHOCK";
  if (liquidity > 0 && liquidity < 1_000) return "LOW_LIQUIDITY";
  if (liquidity < 5_000 && volumeToLiquidityRatio >= 0.5) return "FRAGILE_LIQUIDITY";
  if ((changePercent ?? 0) >= 10 && (changeUsd ?? 0) >= 1_000) return "LIQUIDITY_EXPANDING";
  if ((changePercent ?? 0) <= -10 && (changeUsd ?? 0) <= -1_000) return "LIQUIDITY_DRAINING";
  return "HEALTHY_LIQUIDITY";
}

function getVolumeQualityScore(
  snapshot: TokenSnapshot,
  volumeSpikeScore: number,
  persistedSnapshots: number,
  volumeToLiquidityRatio: number,
  liquidityRegime: TokenFeatures["liquidityRegime"]
): number {
  let score = 0;
  if (volumeSpikeScore >= 2) score += 25;
  if (snapshot.buys5m + snapshot.sells5m >= 20) score += 15;
  if (volumeToLiquidityRatio < 0.4) score += 10;
  if (liquidityRegime === "HEALTHY_LIQUIDITY" || liquidityRegime === "LIQUIDITY_EXPANDING") score += 15;
  if (Math.abs(snapshot.priceChange5m) >= 5 && volumeSpikeScore >= 1.4) score += 20;
  if (persistedSnapshots >= 2) score += 15;
  if (volumeToLiquidityRatio > 1) score -= 20;
  if (liquidityRegime === "LIQUIDITY_SHOCK") score -= 25;
  if (snapshot.buys5m + snapshot.sells5m < 5) score -= 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getVolumeQualityLevel(score: number): TokenFeatures["volumeQualityLevel"] {
  if (score >= 81) return "strong";
  if (score >= 61) return "good";
  if (score >= 31) return "moderate";
  return "poor";
}

function getTrendDirection(snapshot: TokenSnapshot, momentum: number, volatility: number): TokenFeatures["trendDirection"] {
  if (volatility >= 35) return "unstable";
  if (snapshot.priceChange5m > 5 && snapshot.priceChange1h < -5) return "reversal";
  if (momentum >= 8) return "uptrend";
  if (momentum <= -8) return "downtrend";
  return "sideways";
}

function getLiquidityState(change: number | null): TokenFeatures["liquidityState"] {
  if (change === null) return "unknown";
  if (change <= -25) return "sudden_drop";
  if (change >= 25) return "sudden_increase";
  if (change <= -5) return "decreasing";
  if (change >= 5) return "increasing";
  return "stable";
}

function getPressureState(snapshot: TokenSnapshot, buySellRatio: number): TokenFeatures["pressureState"] {
  if (snapshot.traders5m < 10 || snapshot.volume5m <= 0) return "weak_activity";
  if (buySellRatio >= 2.5 && snapshot.buys5m >= 20) return "strong_buy_pressure";
  if (buySellRatio <= 0.4 && snapshot.sells5m >= 20) return "strong_sell_pressure";
  return "balanced";
}

function percentageChange(previous: number | null, current: number | null): number | null {
  if (!previous || current === null) return null;
  return ((current - previous) / previous) * 100;
}

function average(values: number[]): number {
  const usable = values.filter(Number.isFinite);
  if (usable.length === 0) return 0;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function countConsecutive(history: TokenSnapshot[], predicate: (snapshot: TokenSnapshot) => boolean, currentMatches: boolean): number {
  if (!currentMatches) return 0;
  let count = 1;
  for (const snapshot of history) {
    if (!predicate(snapshot)) break;
    count += 1;
  }
  return count;
}

function dominance(side: number, otherSide: number): number {
  const total = side + otherSide;
  return total > 0 ? side / total : 0;
}
