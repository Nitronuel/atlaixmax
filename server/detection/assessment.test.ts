import { describe, expect, it } from 'vitest';
import type { DetectionEvent } from '../../src/shared/detection';
import { classifyEventRelationship, localAssessment, parseAssessmentJson } from './routes';

function event(overrides: Partial<DetectionEvent>): DetectionEvent {
  return {
    id: overrides.id || Math.random().toString(36).slice(2),
    eventType: overrides.eventType || 'Accumulation',
    summary: overrides.summary || 'summary',
    sentiment: overrides.sentiment || 'bullish',
    severity: overrides.severity || 'low',
    score: overrides.score || 61,
    detectedAt: overrides.detectedAt || Date.now(),
    token: {
      name: 'Test Token',
      ticker: 'TEST',
      address: '0xtest',
      chain: 'base',
      pairAddress: '0xpair'
    },
    metrics: {
      volume24h: 100000,
      liquidity: 200000,
      marketCap: 1000000,
      priceChange24h: 2,
      netFlow: 4
    },
    classificationId: 'classification',
    dedupeKey: 'dedupe',
    ...overrides
  };
}

describe('Detection AI assessment context', () => {
  it('classifies bearish latest after bullish history as deterioration', () => {
    const context = classifyEventRelationship([
      event({ id: 'latest', eventType: 'Liquidity Drain', sentiment: 'bearish', severity: 'high', detectedAt: 3000 }),
      event({ id: 'prior-1', eventType: 'Liquidity Added', sentiment: 'bullish', detectedAt: 2000 }),
      event({ id: 'prior-2', eventType: 'Accumulation', sentiment: 'bullish', detectedAt: 1000 })
    ]);

    expect(context.relationship).toBe('sequential_deterioration');
    expect(context.state).toBe('Structural Weakness');
    expect(context.marketBias).toBe('Bearish');
  });

  it('builds structured local fallback without raw scores', () => {
    const events = [
      event({ eventType: 'Accumulation', sentiment: 'bullish', severity: 'low', score: 88, metrics: { volume24h: 100000, liquidity: 200000, marketCap: 1000000, priceChange24h: 6.85, netFlow: 12 } }),
      event({ eventType: 'Distribution', sentiment: 'bearish', score: 72 })
    ];
    const context = classifyEventRelationship(events);
    const assessment = localAssessment('TEST', events, context);

    expect(assessment.summary).toContain('Accumulation');
    expect(assessment.summary).not.toMatch(/score\s*\d+/i);
    expect(assessment.marketBias).toBe('Bullish / Unconfirmed');
    expect(assessment.invalidation).toContain('liquidity thinning');
    expect(assessment.supportingSignals).toContain('+6.85% 24h price change');
    expect(assessment.supportingSignals.join(' ')).not.toMatch(/\$|net flow/i);
  });

  it('describes DEX flow without showing a flow figure', () => {
    const events = [
      event({ metrics: { volume24h: 100000, liquidity: 200000, marketCap: 1000000, priceChange24h: 0, netFlow: 12 } })
    ];
    const assessment = localAssessment('TEST', events, classifyEventRelationship(events));

    expect(assessment.supportingSignals).toContain('Positive DEX flow');
    expect(assessment.supportingSignals.join(' ')).not.toMatch(/net flow|\+12/i);
  });

  it('keeps market bias tied to the latest event when history is mixed', () => {
    const events = [
      event({ id: 'latest', eventType: 'Bullish Continuation', sentiment: 'bullish', severity: 'low', detectedAt: 5000 }),
      event({ id: 'prior-1', eventType: 'Range Breakdown Attempt', sentiment: 'bearish', detectedAt: 4000 }),
      event({ id: 'prior-2', eventType: 'Bearish Continuation', sentiment: 'bearish', detectedAt: 3000 }),
      event({ id: 'prior-3', eventType: 'Accumulation', sentiment: 'bullish', detectedAt: 2000 })
    ];
    const context = classifyEventRelationship(events);
    const assessment = localAssessment('TEST', events, context);

    expect(assessment.marketBias).toBe('Bullish / Unconfirmed');
    expect(assessment.invalidation).toContain('liquidity leaving the pool');
    expect(assessment.watchFor).toContain('Liquidity leaving the pool');
  });

  it('rejects model JSON with prediction or score language', () => {
    const fallback = localAssessment('TEST', [event({})], classifyEventRelationship([event({})]));
    const parsed = parseAssessmentJson(JSON.stringify({
      state: 'Accumulation',
      sequenceLabel: '2-event sequence',
      summary: 'Score 93 means price will pump from here.',
      marketBias: 'Bullish',
      invalidation: 'support failure',
      supportingSignals: ['score 93'],
      watchFor: ['entry']
    }), fallback);

    expect(parsed).toBeNull();
  });

  it('uses backend-controlled bias and invalidation when parsing model JSON', () => {
    const events = [
      event({ id: 'latest', eventType: 'Liquidity Drain', sentiment: 'bearish', severity: 'high', detectedAt: 2000 }),
      event({ id: 'prior', eventType: 'Accumulation', sentiment: 'bullish', detectedAt: 1000 })
    ];
    const fallback = localAssessment('TEST', events, classifyEventRelationship(events));
    const parsed = parseAssessmentJson(JSON.stringify({
      state: 'Recovery',
      sequenceLabel: '2-event sequence',
      summary: 'Liquidity is deteriorating after a prior accumulation read, so the latest event carries more weight while buyers still have room to stabilize the structure.',
      marketBias: 'Bullish',
      invalidation: 'anything',
      supportingSignals: ['price change (6.85)'],
      watchFor: ['anything']
    }), fallback);

    expect(parsed?.marketBias).toBe(fallback.marketBias);
    expect(parsed?.invalidation).toBe(fallback.invalidation);
    expect(parsed?.supportingSignals).toEqual(fallback.supportingSignals);
  });

  it('removes net flow figures from parsed model text', () => {
    const fallback = localAssessment('TEST', [event({})], classifyEventRelationship([event({})]));
    const parsed = parseAssessmentJson(JSON.stringify({
      state: 'Accumulation',
      sequenceLabel: '1-event sequence',
      summary: 'Accumulation is supported by a positive net flow of +$21 while price structure remains constructive. Confirmation still depends on liquidity holding and buyers continuing to absorb supply.',
      marketBias: 'Bullish',
      invalidation: 'anything',
      supportingSignals: ['+$21 net flow'],
      watchFor: ['anything']
    }), fallback);

    expect(parsed?.summary).toContain('positive DEX flow');
    expect(parsed?.summary).not.toMatch(/\+\$21|net flow/i);
    expect(parsed?.supportingSignals).toEqual(fallback.supportingSignals);
  });
});
