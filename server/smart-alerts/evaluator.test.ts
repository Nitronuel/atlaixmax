import { describe, expect, it } from 'vitest';
import { evaluateSmartAlertRule, parseAlertThreshold, type SmartAlertRuleSnapshot } from './evaluator';

describe('Smart Alert evaluator', () => {
  it('matches numeric price thresholds', () => {
    const result = evaluateSmartAlertRule(makeRule({
      alert_type: 'Price',
      condition: 'above',
      threshold: '$100'
    }), {
      tokenLabel: 'TKN',
      tokenAddress: 'token',
      priceUsd: 125
    }, new Date('2026-07-02T10:00:00Z'));

    expect(result.shouldTrigger).toBe(true);
    expect(result.observedValue).toBe('$125');
    expect(result.lastError).toBeNull();
  });

  it('establishes a percent baseline before matching movement', () => {
    const first = evaluateSmartAlertRule(makeRule({
      alert_type: 'Volume',
      condition: 'changes_by_percent',
      threshold_kind: 'percent',
      threshold: '20%'
    }), {
      volume24hUsd: 100
    });

    expect(first.shouldTrigger).toBe(false);
    expect(first.nextBaselineValue).toBe(100);

    const second = evaluateSmartAlertRule(makeRule({
      alert_type: 'Volume',
      condition: 'changes_by_percent',
      threshold_kind: 'percent',
      threshold: '20%',
      baseline_value: 100
    }), {
      volume24hUsd: 125
    });

    expect(second.shouldTrigger).toBe(true);
    expect(second.observedValue).toBe('+25.0%');
    expect(second.nextBaselineValue).toBe(125);
  });

  it('matches event and severity snapshots when supplied', () => {
    const alpha = evaluateSmartAlertRule(makeRule({
      alert_type: 'Alpha',
      condition: 'event_is',
      threshold_kind: 'event',
      threshold: 'Liquidity Event'
    }), {
      alphaEvent: 'Liquidity Event'
    });
    const risk = evaluateSmartAlertRule(makeRule({
      alert_type: 'Risk',
      condition: 'severity_is',
      threshold_kind: 'severity',
      threshold: 'High'
    }), {
      riskSeverity: 'High'
    });

    expect(alpha.shouldTrigger).toBe(true);
    expect(risk.shouldTrigger).toBe(true);
  });

  it('parses compact currency thresholds', () => {
    expect(parseAlertThreshold('$1.5M')).toBe(1_500_000);
    expect(parseAlertThreshold('25%', 'percent')).toBe(25);
  });
});

function makeRule(overrides: Partial<SmartAlertRuleSnapshot>): SmartAlertRuleSnapshot {
  return {
    id: 'rule-1',
    user_id: 'user-1',
    alert_type: 'Price',
    target: 'TKN',
    chain_id: 'solana',
    condition: 'above',
    threshold_kind: 'currency',
    threshold: '$100',
    trigger_label: 'Test alert',
    cooldown_minutes: 60,
    last_triggered_at: null,
    baseline_value: null,
    ...overrides
  };
}
