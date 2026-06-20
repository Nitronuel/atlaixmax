import { describe, expect, it } from 'vitest';
import { parseBubblemapsRequest, validateBubblemapsRequest } from './validation';

describe('Bubblemaps validation', () => {
  it('normalizes supported chain aliases', () => {
    const params = new URLSearchParams({
      chain: 'ethereum',
      address: '0x1111111111111111111111111111111111111111'
    });

    expect(parseBubblemapsRequest(params)).toEqual({
      chain: 'eth',
      address: '0x1111111111111111111111111111111111111111'
    });
  });

  it('rejects malformed EVM addresses', () => {
    expect(() => validateBubblemapsRequest('base', 'not-a-token')).toThrow('EVM scans require a valid 0x token address.');
  });

  it('accepts Solana-style token addresses', () => {
    expect(() => validateBubblemapsRequest('solana', 'So11111111111111111111111111111111111111112')).not.toThrow();
  });
});
