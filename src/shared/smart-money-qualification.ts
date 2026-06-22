export type SmartMoneyTier = 'elite' | 'strong' | 'watchlist' | 'whale' | 'rejected';

export type SmartMoneyEvidence = {
  netWorthUsd?: number;
  completedTrades?: number;
  uniqueTokens?: number;
  activeAgeDays?: number;
  recentTrades30d?: number;
  realizedPnl30d?: number;
  realizedPnl90d?: number;
  realizedRoi90d?: number;
  winRate?: number;
  profitFactor?: number;
  rugExposureRate?: number;
  severeLossRate?: number;
  largestTradeProfitShare?: number;
  entryAlpha24h?: number;
  entryAlpha7d?: number;
  activePositions?: number;
  profitablePositions?: number;
  pnlPercent?: number;
};

export type SmartMoneyQualification = {
  score: number;
  tier: SmartMoneyTier;
  qualified: boolean;
  hardFailures: string[];
  reasons: string[];
  evaluatedAt: number;
  metrics: {
    netWorthUsd: number;
    completedTrades: number;
    uniqueTokens: number;
    activeAgeDays: number;
    recentTrades30d: number;
    realizedPnl30d: number;
    realizedPnl90d: number;
    realizedRoi90d: number;
    winRate: number;
    profitFactor: number;
    rugExposureRate: number;
    severeLossRate: number;
    largestTradeProfitShare: number;
    entryAlpha24h?: number;
    entryAlpha7d?: number;
    activePositions: number;
    profitablePositions: number;
    pnlPercent: number;
  };
};

const HARD_FILTERS = {
  completedTrades: 30,
  uniqueTokens: 10,
  activeAgeDays: 30,
  recentTrades30d: 3,
  profitFactor: 1.5,
  rugExposureRate: 0.15,
  largestTradeProfitShare: 0.5
};

function numberOrZero(value: number | undefined) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function roundScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function positive(value: number) {
  return value > 0;
}

function classify(score: number, hardFailures: string[], netWorthUsd: number): SmartMoneyTier {
  if (hardFailures.length) return netWorthUsd >= 100_000 ? 'whale' : 'rejected';
  if (score >= 90) return 'elite';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'watchlist';
  return 'rejected';
}

export function evaluateSmartMoneyWallet(evidence: SmartMoneyEvidence): SmartMoneyQualification {
  const metrics = {
    netWorthUsd: numberOrZero(evidence.netWorthUsd),
    completedTrades: numberOrZero(evidence.completedTrades),
    uniqueTokens: numberOrZero(evidence.uniqueTokens),
    activeAgeDays: numberOrZero(evidence.activeAgeDays),
    recentTrades30d: numberOrZero(evidence.recentTrades30d),
    realizedPnl30d: numberOrZero(evidence.realizedPnl30d),
    realizedPnl90d: numberOrZero(evidence.realizedPnl90d),
    realizedRoi90d: numberOrZero(evidence.realizedRoi90d),
    winRate: numberOrZero(evidence.winRate),
    profitFactor: numberOrZero(evidence.profitFactor),
    rugExposureRate: numberOrZero(evidence.rugExposureRate),
    severeLossRate: numberOrZero(evidence.severeLossRate),
    largestTradeProfitShare: numberOrZero(evidence.largestTradeProfitShare),
    entryAlpha24h: evidence.entryAlpha24h,
    entryAlpha7d: evidence.entryAlpha7d,
    activePositions: numberOrZero(evidence.activePositions),
    profitablePositions: numberOrZero(evidence.profitablePositions),
    pnlPercent: numberOrZero(evidence.pnlPercent)
  };

  const hardFailures: string[] = [];
  if (metrics.completedTrades < HARD_FILTERS.completedTrades) hardFailures.push('Needs at least 30 completed trades');
  if (metrics.uniqueTokens < HARD_FILTERS.uniqueTokens) hardFailures.push('Needs at least 10 unique traded tokens');
  if (metrics.activeAgeDays < HARD_FILTERS.activeAgeDays) hardFailures.push('Needs at least 30 days of wallet activity');
  if (metrics.recentTrades30d < HARD_FILTERS.recentTrades30d) hardFailures.push('Needs at least 3 recent trades in 30 days');
  if (!positive(metrics.realizedPnl30d)) hardFailures.push('Needs positive 30d realized PnL');
  if (!positive(metrics.realizedPnl90d)) hardFailures.push('Needs positive 90d realized PnL');
  if (metrics.profitFactor < HARD_FILTERS.profitFactor) hardFailures.push('Needs profit factor of at least 1.5x');
  if (metrics.rugExposureRate > HARD_FILTERS.rugExposureRate) hardFailures.push('Rug exposure is too high');
  if (metrics.largestTradeProfitShare > HARD_FILTERS.largestTradeProfitShare) hardFailures.push('Depends too much on one winning trade');

  const reasons: string[] = [];
  let score = 0;

  if (metrics.realizedRoi90d >= 100) {
    score += 30;
    reasons.push(`90d realized ROI is ${metrics.realizedRoi90d.toFixed(1)}%`);
  } else if (metrics.realizedRoi90d >= 50) {
    score += 24;
    reasons.push(`Strong 90d realized ROI at ${metrics.realizedRoi90d.toFixed(1)}%`);
  } else if (metrics.realizedRoi90d >= 20) {
    score += 18;
    reasons.push(`Positive 90d realized ROI at ${metrics.realizedRoi90d.toFixed(1)}%`);
  } else if (metrics.realizedPnl90d > 0) {
    score += 10;
  }

  if (metrics.profitFactor >= 3) {
    score += 15;
    reasons.push(`Profit factor is ${metrics.profitFactor.toFixed(2)}x`);
  } else if (metrics.profitFactor >= 2) {
    score += 12;
    reasons.push(`Profit factor is ${metrics.profitFactor.toFixed(2)}x`);
  } else if (metrics.profitFactor >= 1.5) {
    score += 8;
  }

  if (metrics.winRate >= 70) {
    score += 10;
    reasons.push(`Win rate is ${metrics.winRate.toFixed(1)}%`);
  } else if (metrics.winRate >= 60) {
    score += 8;
  } else if (metrics.winRate >= 55) {
    score += 5;
  } else if (metrics.winRate >= 45 && metrics.profitFactor >= 2) {
    score += 4;
    reasons.push('Lower win rate is offset by strong winners');
  }

  if (metrics.realizedPnl30d > 0 && metrics.realizedPnl90d > 0) {
    score += 15;
    reasons.push('Realized PnL is positive across 30d and 90d');
  }

  if (metrics.rugExposureRate <= 0.05 && metrics.severeLossRate <= 0.1) {
    score += 15;
    reasons.push('Risk exposure is controlled');
  } else if (metrics.rugExposureRate <= 0.1 && metrics.severeLossRate <= 0.2) {
    score += 10;
  } else if (metrics.rugExposureRate <= 0.15) {
    score += 5;
  }

  if (metrics.completedTrades >= 75 && metrics.uniqueTokens >= 20) {
    score += 10;
    reasons.push(`${metrics.completedTrades} completed trades across ${metrics.uniqueTokens} tokens`);
  } else if (metrics.completedTrades >= 30 && metrics.uniqueTokens >= 10) {
    score += 7;
  }

  if (metrics.recentTrades30d >= 5 && metrics.activeAgeDays >= 90) {
    score += 8;
  } else if (metrics.recentTrades30d >= 3 && metrics.activeAgeDays >= 30) {
    score += 5;
  }

  if (typeof metrics.entryAlpha7d === 'number' && metrics.entryAlpha7d >= 20) {
    score += 7;
    reasons.push(`7d entry alpha is ${metrics.entryAlpha7d.toFixed(1)}%`);
  } else if (typeof metrics.entryAlpha24h === 'number' && metrics.entryAlpha24h >= 5) {
    score += 5;
    reasons.push(`24h entry alpha is ${metrics.entryAlpha24h.toFixed(1)}%`);
  }

  if (metrics.largestTradeProfitShare > 0 && metrics.largestTradeProfitShare <= 0.35) {
    score += 5;
  }

  if (hardFailures.length) score = Math.min(score, metrics.netWorthUsd >= 100_000 ? 55 : 45);

  const normalizedScore = roundScore(score);
  const tier = classify(normalizedScore, hardFailures, metrics.netWorthUsd);

  return {
    score: normalizedScore,
    tier,
    qualified: tier === 'elite' || tier === 'strong',
    hardFailures,
    reasons: reasons.slice(0, 5),
    evaluatedAt: Date.now(),
    metrics
  };
}
