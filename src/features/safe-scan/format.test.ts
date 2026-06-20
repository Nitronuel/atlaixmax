import { describe, expect, it } from 'vitest';
import { formatPercent, formatPercentPoints } from './format';

describe('Safe Scan percent formatting', () => {
  it('keeps Bubblemaps cluster shares in percent-point scale', () => {
    expect(formatPercentPoints(0.934)).toBe('0.93%');
  });

  it('still scales holder shares from fraction scale', () => {
    expect(formatPercent(0.0376)).toBe('3.76%');
  });
});
