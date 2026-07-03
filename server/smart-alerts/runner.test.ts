import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartAlertRunner } from './runner';
import type { SmartAlertRow } from './store';

describe('Smart Alert runner', () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = process.env.SMART_ALERTS_PROVIDER_TIMEOUT_MS;

  beforeEach(() => {
    process.env.SMART_ALERTS_PROVIDER_TIMEOUT_MS = '1';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv('SMART_ALERTS_PROVIDER_TIMEOUT_MS', originalTimeout);
    vi.restoreAllMocks();
  });

  it('records provider timeouts on the rule without leaving the runner in flight', async () => {
    globalThis.fetch = vi.fn((_url, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as typeof fetch;
    const store = makeStore([makeRule()]);
    const runner = new SmartAlertRunner(store as any);

    const status = await runner.runNow();

    expect(status.running).toBe(false);
    expect(status.lastRunStatus).toBe('error');
    expect(status.lastError).toContain('DexScreener token lookup timed out.');
    expect(store.updates[0].patch.last_error).toBe('DexScreener token lookup timed out.');
  });

  it('does not mark duplicate trigger history as a rule failure', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      pairs: [{
        chainId: 'solana',
        pairAddress: 'pair-1',
        baseToken: { address: 'TokenAddress111111111111111111111111111111', symbol: 'TKN' },
        priceUsd: '125',
        liquidity: { usd: 50_000 },
        volume: { h24: 10_000 },
        txns: { h24: { buys: 10, sells: 2 } }
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    const store = makeStore([makeRule()], false);
    const runner = new SmartAlertRunner(store as any);

    const status = await runner.runNow();
    const lastPatch = store.updates.at(-1)?.patch;

    expect(status.lastRunStatus).toBe('success');
    expect(store.insertCalls).toBe(1);
    expect(lastPatch?.last_error).toBeNull();
    expect(lastPatch?.enabled).toBeUndefined();
  });

  it('pauses unsupported legacy market alert types with a clear error', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const store = makeStore([makeRule({ alert_type: 'Whale', condition: 'buy_above' })]);
    const runner = new SmartAlertRunner(store as any);

    const status = await runner.runNow();
    const patch = store.updates[0].patch;

    expect(status.lastRunStatus).toBe('success');
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(patch.enabled).toBe(false);
    expect(patch.last_error).toContain('Whale Smart Alerts are not supported');
    expect(patch.metadata).toMatchObject({ status: 'paused' });
  });
});

function makeRule(overrides: Partial<SmartAlertRow> = {}): SmartAlertRow {
  const now = new Date('2026-07-02T10:00:00Z').toISOString();
  return {
    id: 'rule-1',
    user_id: 'user-1',
    alert_type: 'Price',
    target: 'TKN',
    chain_id: 'solana',
    token_address: 'TokenAddress111111111111111111111111111111',
    condition: 'above',
    threshold_kind: 'currency',
    threshold: '$100',
    trigger_label: 'Price above $100',
    notification_channels: ['in_app'],
    cooldown_minutes: 60,
    enabled: true,
    last_checked_at: null,
    last_triggered_at: null,
    last_observed_value: null,
    last_observed_at: null,
    baseline_value: null,
    baseline_observed_at: null,
    trigger_count: 0,
    last_error: null,
    metadata: {},
    created_at: now,
    updated_at: now,
    ...overrides
  };
}

function makeStore(rules: SmartAlertRow[], insertResult = true) {
  return {
    updates: [] as Array<{ id: string; patch: Partial<SmartAlertRow>; userId?: string }>,
    insertCalls: 0,
    async listEnabledRules() {
      return rules;
    },
    async updateRule(id: string, patch: Partial<SmartAlertRow>, userId?: string) {
      this.updates.push({ id, patch, userId });
      return { ...rules.find((rule) => rule.id === id), ...patch } as SmartAlertRow;
    },
    async insertTrigger() {
      this.insertCalls += 1;
      return insertResult;
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
