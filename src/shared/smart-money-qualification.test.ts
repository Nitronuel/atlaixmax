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
  largestTradeProfitShare: 0.28
};

describe('smart money qualification', () => {
  it('qualifies consistent profitable wallets', () => {
    const result = evaluateSmartMoneyWallet(baseEvidence);

    expect(result.qualified).toBe(true);
    expect(result.tier).toBe('strong');
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

  it('rejects wallets that rely on one winning trade', () => {
    const result = evaluateSmartMoneyWallet({
      ...baseEvidence,
      largestTradeProfitShare: 0.72
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
});
