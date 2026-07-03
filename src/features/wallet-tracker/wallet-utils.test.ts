import { describe, expect, it } from 'vitest';
import { buildWalletStats, detectWalletAddressType, evaluateSmartMoney, getDefaultChain, isChainCompatible, normalizeWalletChain, validateWalletAddress } from './wallet-utils';

describe('wallet utilities', () => {
  it('validates EVM and Solana wallet addresses', () => {
    expect(detectWalletAddressType('0x0000000000000000000000000000000000000000')).toBe('evm');
    expect(detectWalletAddressType('So11111111111111111111111111111111111111112')).toBe('solana');
    expect(validateWalletAddress('not-a-wallet')).toMatchObject({ isValid: false });
  });

  it('keeps incompatible chains out of profile requests', () => {
    expect(getDefaultChain('evm')).toBe('Ethereum');
    expect(getDefaultChain('solana')).toBe('Solana');
    expect(isChainCompatible('Solana', 'evm')).toBe(false);
    expect(isChainCompatible('Ethereum', 'solana')).toBe(false);
  });

  it('normalizes unknown chains to the aggregate EVM view', () => {
    expect(normalizeWalletChain('base')).toBe('Base');
    expect(normalizeWalletChain('missing')).toBe('All Chains');
  });

  it('keeps portfolio-only scores out of Smart Money qualification', () => {
    const result = evaluateSmartMoney({
      netWorth: '$125,000.00',
      winRate: '67%',
      totalPnl: '+24.50%',
      realizedPnl: 'N/A',
      unrealizedPnl: 'N/A',
      activePositions: 5,
      profitablePositions: '4',
      avgHoldTime: 'N/A'
    });

    expect(result.qualified).toBe(false);
    expect(result.hardFailures).toContain('Needs at least 30 completed trades');
  });

  it('rejects weak tracked wallets from Smart Money', () => {
    const result = evaluateSmartMoney({
      netWorth: '$4,500.00',
      winRate: '30%',
      totalPnl: '-8.00%',
      realizedPnl: 'N/A',
      unrealizedPnl: 'N/A',
      activePositions: 1,
      profitablePositions: '0',
      avgHoldTime: 'N/A'
    });

    expect(result.qualified).toBe(false);
  });

  it('does not use wallet return as win rate when position wins are unavailable', () => {
    const stats = buildWalletStats([], '$0.11', {
      totalGain: -284,
      totalGainPercent: -4.12,
      realizedGain: -264,
      unrealizedGain: -20,
      netInvested: 6900,
      totalFee: 0
    });

    expect(stats.winRate).toBe('0%');
    expect(stats.totalPnl).toBe('-$284');
    expect(stats.realizedPnl).toBe('-$264');
    expect(stats.unrealizedPnl).toBe('-$20');
  });
});
