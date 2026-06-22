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
  averageWinnerRoi?: number;
  medianWinnerRoi?: number;
  profitableTokenRate?: number;
  profitableTokenCount?: number;
  highRoiWinnerCount?: number;
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
    averageWinnerRoi: number;
    medianWinnerRoi: number;
    profitableTokenRate: number;
    profitableTokenCount: number;
    highRoiWinnerCount: number;
    entryAlpha24h?: number;
    entryAlpha7d?: number;
    activePositions: number;
    profitablePositions: number;
    pnlPercent: number;
  };
};

const HARD_FILTERS = {
  netWorthUsd: 25_000,
  completedTrades: 30,
  uniqueTokens: 10,
  activeAgeDays: 30,
  recentTrades30d: 3,
  realizedPnl90d: 10_000,
  profitFactor: 1.8,
  strongProfitFactor: 2.5,
  minimumWinRate: 50,
  flexibleWinRate: 45,
  rugExposureRate: 0.1,
  severeLossRate: 0.1,
  largestTradeProfitShare: 0.35,
  averageWinnerRoi: 30,
  profitableTokenRate: 0.3,
  profitableTokenCount: 4,
  highRoiWinnerCount: 2
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

function formatUsd(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0, style: 'currency', currency: 'USD' });
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
    averageWinnerRoi: numberOrZero(evidence.averageWinnerRoi),
    medianWinnerRoi: numberOrZero(evidence.medianWinnerRoi),
    profitableTokenRate: numberOrZero(evidence.profitableTokenRate),
    profitableTokenCount: numberOrZero(evidence.profitableTokenCount),
    highRoiWinnerCount: numberOrZero(evidence.highRoiWinnerCount),
    entryAlpha24h: evidence.entryAlpha24h,
    entryAlpha7d: evidence.entryAlpha7d,
    activePositions: numberOrZero(evidence.activePositions),
    profitablePositions: numberOrZero(evidence.profitablePositions),
    pnlPercent: numberOrZero(evidence.pnlPercent)
  };

  const hardFailures: string[] = [];
  if (metrics.netWorthUsd < HARD_FILTERS.netWorthUsd) hardFailures.push('Needs at least $25,000 in tracked capital');
  if (metrics.completedTrades < HARD_FILTERS.completedTrades) hardFailures.push('Needs at least 30 completed trades');
  if (metrics.uniqueTokens < HARD_FILTERS.uniqueTokens) hardFailures.push('Needs at least 10 unique traded tokens');
  if (metrics.activeAgeDays < HARD_FILTERS.activeAgeDays) hardFailures.push('Needs at least 30 days of wallet activity');
  if (metrics.recentTrades30d < HARD_FILTERS.recentTrades30d) hardFailures.push('Needs at least 3 recent trades in 30 days');
  if (!positive(metrics.realizedPnl30d)) hardFailures.push('Needs positive 30d realized PnL');
  if (metrics.realizedPnl90d < HARD_FILTERS.realizedPnl90d) hardFailures.push('Needs at least $10,000 realized PnL in 90 days');
  if (metrics.profitFactor < HARD_FILTERS.profitFactor) hardFailures.push('Needs profit factor of at least 1.8x');
  if (metrics.winRate < HARD_FILTERS.minimumWinRate && !(metrics.winRate >= HARD_FILTERS.flexibleWinRate && metrics.profitFactor >= HARD_FILTERS.strongProfitFactor)) hardFailures.push('Needs at least 50% win rate, or 45% with 2.5x profit factor');
  if (metrics.rugExposureRate > HARD_FILTERS.rugExposureRate) hardFailures.push('Rug exposure is too high');
  if (metrics.severeLossRate > HARD_FILTERS.severeLossRate) hardFailures.push('Severe loss exposure is too high');
  if (metrics.largestTradeProfitShare > HARD_FILTERS.largestTradeProfitShare) hardFailures.push('Depends too much on one winning trade');
  if (metrics.profitableTokenCount < HARD_FILTERS.profitableTokenCount) hardFailures.push('Needs at least 4 profitable tokens');
  if (metrics.profitableTokenRate < HARD_FILTERS.profitableTokenRate) hardFailures.push('Needs at least 30% profitable traded tokens');
  if (metrics.averageWinnerRoi < HARD_FILTERS.averageWinnerRoi) hardFailures.push('Needs average winning token ROI of at least 30%');
  if (metrics.highRoiWinnerCount < HARD_FILTERS.highRoiWinnerCount) hardFailures.push('Needs at least 2 winning tokens above 30% ROI');

  const reasons: string[] = [];
  let score = 0;

  if (metrics.realizedPnl90d >= 50_000) {
    score += 15;
    reasons.push(`90d realized PnL is ${formatUsd(metrics.realizedPnl90d)}`);
  } else if (metrics.realizedPnl90d >= 10_000) {
    score += 10;
    reasons.push(`90d realized PnL is ${formatUsd(metrics.realizedPnl90d)}`);
  }

  if (metrics.realizedRoi90d >= 100) {
    score += 20;
    reasons.push(`90d realized ROI is ${metrics.realizedRoi90d.toFixed(1)}%`);
  } else if (metrics.realizedRoi90d >= 50) {
    score += 16;
    reasons.push(`Strong 90d realized ROI at ${metrics.realizedRoi90d.toFixed(1)}%`);
  } else if (metrics.realizedRoi90d >= 20) {
    score += 12;
    reasons.push(`Positive 90d realized ROI at ${metrics.realizedRoi90d.toFixed(1)}%`);
  } else if (metrics.realizedPnl90d > 0) {
    score += 6;
  }

  if (metrics.profitFactor >= 3) {
    score += 15;
    reasons.push(`Profit factor is ${metrics.profitFactor.toFixed(2)}x`);
  } else if (metrics.profitFactor >= 2) {
    score += 12;
    reasons.push(`Profit factor is ${metrics.profitFactor.toFixed(2)}x`);
  } else if (metrics.profitFactor >= 1.8) {
    score += 8;
  }

  if (metrics.winRate >= 70) {
    score += 10;
    reasons.push(`Win rate is ${metrics.winRate.toFixed(1)}%`);
  } else if (metrics.winRate >= 60) {
    score += 8;
  } else if (metrics.winRate >= 55) {
    score += 5;
  } else if (metrics.winRate >= 45 && metrics.profitFactor >= 2.5) {
    score += 4;
    reasons.push('Lower win rate is offset by strong winners');
  }

  if (metrics.realizedPnl30d > 0 && metrics.realizedPnl90d > 0) {
    score += 15;
    reasons.push('Realized PnL is positive across 30d and 90d');
  }

  if (metrics.rugExposureRate <= 0.05 && metrics.severeLossRate <= 0.05) {
    score += 15;
    reasons.push('Risk exposure is controlled');
  } else if (metrics.rugExposureRate <= 0.1 && metrics.severeLossRate <= 0.1) {
    score += 10;
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

  if (metrics.averageWinnerRoi >= 50 && metrics.profitableTokenRate >= 0.4) {
    score += 10;
    reasons.push(`Average winning token ROI is ${metrics.averageWinnerRoi.toFixed(1)}%`);
  } else if (metrics.averageWinnerRoi >= 30 && metrics.profitableTokenRate >= 0.3) {
    score += 7;
    reasons.push(`Average winning token ROI is ${metrics.averageWinnerRoi.toFixed(1)}%`);
  }

  if (metrics.profitableTokenCount >= 4 && metrics.uniqueTokens > 0) {
    score += 5;
    reasons.push(`${metrics.profitableTokenCount} profitable tokens out of ${metrics.uniqueTokens} traded`);
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
