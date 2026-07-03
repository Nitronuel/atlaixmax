import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWalletActivityAlert } from './wallet-alerts';
import type { CreateRuleInput, SmartAlertRow } from './store';

describe('wallet activity alerts', () => {
  const originalCallbackUrl = process.env.ZERION_WEBHOOK_CALLBACK_URL;
  const originalApiKey = process.env.ZERION_API_KEY;

  beforeEach(() => {
    delete process.env.ZERION_WEBHOOK_CALLBACK_URL;
    delete process.env.ZERION_API_KEY;
  });

  afterEach(() => {
    restoreEnv('ZERION_WEBHOOK_CALLBACK_URL', originalCallbackUrl);
    restoreEnv('ZERION_API_KEY', originalApiKey);
  });

  it('uses the database-safe minimum cooldown by default', async () => {
    const store = makeStore();

    const result = await createWalletActivityAlert(store as any, {
      address: '0x1111111111111111111111111111111111111111',
      chain: 'ethereum',
      eventTypes: ['any'],
      notificationChannels: ['in_app'],
      ignoreSpam: true
    }, 'user-1');

    expect(store.created?.cooldownMinutes).toBe(1);
    expect(result.rule.cooldown_minutes).toBe(1);
    expect(result.rule.last_error).toContain('ZERION_WEBHOOK_CALLBACK_URL');
  });
});

function makeStore() {
  return {
    created: null as CreateRuleInput | null,
    rules: [] as SmartAlertRow[],
    async listRules() {
      return this.rules;
    },
    async createRule(input: CreateRuleInput, userId: string) {
      this.created = input;
      const now = new Date('2026-07-02T10:00:00Z').toISOString();
      const row: SmartAlertRow = {
        id: 'rule-1',
        user_id: userId,
        alert_type: input.alertType,
        target: input.target,
        chain_id: input.chainId,
        token_address: input.tokenAddress || null,
        condition: input.condition,
        threshold_kind: input.thresholdKind,
        threshold: input.threshold,
        trigger_label: input.triggerLabel,
        notification_channels: input.notificationChannels || ['in_app'],
        cooldown_minutes: input.cooldownMinutes ?? 60,
        enabled: true,
        last_checked_at: null,
        last_triggered_at: null,
        last_observed_value: null,
        last_observed_at: null,
        baseline_value: null,
        baseline_observed_at: null,
        trigger_count: 0,
        last_error: null,
        metadata: input.metadata || {},
        created_at: now,
        updated_at: now
      };
      this.rules.unshift(row);
      return row;
    },
    async updateRule(id: string, patch: Partial<SmartAlertRow>) {
      const index = this.rules.findIndex((rule) => rule.id === id);
      this.rules[index] = { ...this.rules[index], ...patch };
      return this.rules[index];
    }
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
