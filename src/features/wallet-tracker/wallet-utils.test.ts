import { describe, expect, it } from 'vitest';
import { detectWalletAddressType, getDefaultChain, isChainCompatible, normalizeWalletChain, validateWalletAddress } from './wallet-utils';

describe('wallet utilities', () => {
  it('validates EVM and Solana wallet addresses', () => {
    expect(detectWalletAddressType('0x0000000000000000000000000000000000000000')).toBe('evm');
    expect(detectWalletAddressType('So11111111111111111111111111111111111111112')).toBe('solana');
    expect(validateWalletAddress('not-a-wallet')).toMatchObject({ isValid: false });
  });

  it('keeps incompatible chains out of profile requests', () => {
    expect(getDefaultChain('evm')).toBe('All Chains');
    expect(getDefaultChain('solana')).toBe('Solana');
    expect(isChainCompatible('Solana', 'evm')).toBe(false);
    expect(isChainCompatible('Ethereum', 'solana')).toBe(false);
  });

  it('normalizes unknown chains to the aggregate EVM view', () => {
    expect(normalizeWalletChain('base')).toBe('Base');
    expect(normalizeWalletChain('missing')).toBe('All Chains');
  });
});
