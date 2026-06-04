import { describe, expect, it } from 'vitest';
import { parseInsightXRequest, validateInsightXRequest } from './validation';

describe('InsightX validation', () => {
  it('normalizes supported network aliases', () => {
    const params = new URLSearchParams({
      network: 'ethereum',
      address: '0x1111111111111111111111111111111111111111'
    });

    expect(parseInsightXRequest(params)).toEqual({
      network: 'eth',
      address: '0x1111111111111111111111111111111111111111'
    });
  });

  it('rejects malformed EVM addresses', () => {
    expect(() => validateInsightXRequest('base', 'not-a-token')).toThrow('EVM scans require a valid 0x token address.');
  });

  it('accepts Solana-style token addresses', () => {
    expect(() => validateInsightXRequest('sol', 'So11111111111111111111111111111111111111112')).not.toThrow();
  });
});
