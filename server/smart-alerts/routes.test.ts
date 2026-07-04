import { describe, expect, it } from 'vitest';
import { unsupportedMarketRuleTypes } from './routes';

describe('Intelligence Monitor route validation', () => {
  it('allows supported live market rule types', () => {
    expect(unsupportedMarketRuleTypes({
      alertType: 'Price',
      metadata: {
        conditions: [
          { alertType: 'Volume' },
          { alertType: 'Liquidity' }
        ]
      }
    })).toEqual([]);
  });

  it('rejects unsupported market runner rule types', () => {
    expect(unsupportedMarketRuleTypes({
      alertType: 'Price',
      metadata: {
        conditions: [
          { alertType: 'Whale' },
          { alertType: 'Risk' },
          { alertType: 'Whale' }
        ]
      }
    })).toEqual(['Whale', 'Risk']);
  });
});
