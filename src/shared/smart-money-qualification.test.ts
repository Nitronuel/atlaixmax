import { describe, expect, it } from 'vitest';
import { evaluateSmartMoneyWallet } from './smart-money-qualification';

const baseEvidence = {
  netWorthUsd: 250_000,
  completedTrades: 48,
  uniqueTokens: 16,
  activeAgeDays: 72,
  recentTrades30d: 8,
  realizedPnl30d: 12_000,
  realizedPnl90d: 38_000,
  realizedRoi90d: 46,
  winRate: 62,
  profitFactor: 2.2,
  rugExposureRate: 0.04,
  severeLossRate: 0.08,
  largestTradeProfitShare: 0.28,
  averageWinnerRoi: 36,
  medianWinnerRoi: 24,
  profitableTokenRate: 0.44,
  profitableTokenCount: 7,
  highRoiWinnerCount: 3
};

describe('smart money qualification', () => {
  it('qualifies consistent profitable wallets', () => {
    const result = evaluateSmartMoneyWallet(baseEvidence);

    expect(result.qualified).toBe(true);
    expect(result.tier).toBe('elite');
    expect(result.hardFailures).toEqual([]);
  });

  it('keeps rich wallets out when trading proof is weak', () => {
    const result = evaluateSmartMoneyWallet({
      netWorthUsd: 90_000_000,
      completedTrades: 3,
      uniqueTokens: 3,
      activeAgeDays: 8,
      recentTrades30d: 2,
      realizedPnl30d: 0,
      realizedPnl90d: 0,
      winRate: 44,
      profitFactor: 0.9,
      rugExposureRate: 0,
      severeLossRate: 0,
      largestTradeProfitShare: 0
    });

    expect(result.qualified).toBe(false);
    expect(result.tier).toBe('whale');
    expect(result.hardFailures).toContain('Needs at least 30 completed trades');
  });

  it('allows lower win rate when profit factor is strong', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      winRate: 46,
      profitFactor: 3.4,
      realizedRoi90d: 80
    });

    expect(result.qualified).toBe(true);
    expect(result.reasons).toContain('Lower win rate is offset by strong winners');
  });

  it('rejects positive but tiny realized PnL', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      realizedPnl90d: 9_999
    });

    expect(result.qualified).toBe(false);
    expect(result.hardFailures).toContain('Needs at least $10,000 realized PnL in 90 days');
  });

  it('rejects wallets that rely on one winning trade', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      largestTradeProfitShare: 0.36
    });

    expect(result.qualified).toBe(false);
    expect(result.hardFailures).toContain('Depends too much on one winning trade');
  });

  it('rejects rug-heavy wallets', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      rugExposureRate: 0.22
    });

    expect(result.qualified).toBe(false);
    expect(result.hardFailures).toContain('Rug exposure is too high');
  });

  it('rejects weak token-level performance', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      profitableTokenRate: 0.25,
      averageWinnerRoi: 22,
      highRoiWinnerCount: 1
    });

    expect(result.qualified).toBe(false);
    expect(result.hardFailures).toContain('Needs at least 30% profitable traded tokens');
    expect(result.hardFailures).toContain('Needs average winning token ROI of at least 30%');
    expect(result.hardFailures).toContain('Needs at least 2 winning tokens above 30% ROI');
  });

  it('rejects lower win rate without exceptional profit factor', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      winRate: 46,
      profitFactor: 2.4
    });

    expect(result.qualified).toBe(false);
    expect(result.hardFailures).toContain('Needs at least 50% win rate, or 45% with 2.5x profit factor');
  });
});
