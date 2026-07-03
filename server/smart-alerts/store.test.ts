import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DetectionEvent } from '../../src/shared/detection';
import { SmartAlertStore } from './store';

describe('Smart Alert store', () => {
  const originalCwd = process.cwd();
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'atlaix-smart-alert-store-'));
    process.chdir(workspace);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv('SUPABASE_URL', originalSupabaseUrl);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalSupabaseServiceRoleKey);
    restoreEnv('SUPABASE_SERVICE_KEY', originalSupabaseServiceKey);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('updates an existing detection subscription when Telegram is selected later', async () => {
    const store = new SmartAlertStore();
    const userId = '11111111-1111-4111-8111-111111111111';
    const tokenAddress = 'TokenAddress111111111111111111111111111111';

    const first = await store.createDetectionSubscription({
      userId,
      scope: 'token',
      chainId: 'solana',
      tokenAddress,
      tokenName: 'Example Token',
      tokenSymbol: 'EXM',
      threshold: 'Liquidity Added',
      source: 'detection_page'
    });

    const updated = await store.createDetectionSubscription({
      userId,
      scope: 'token',
      chainId: 'solana',
      tokenAddress,
      tokenName: 'Example Token',
      tokenSymbol: 'EXM',
      threshold: 'Liquidity Added',
      notificationChannels: ['in_app', 'telegram'],
      source: 'smart_alerts_page'
    });

    const rules = await store.listRules(userId);
    expect(updated.id).toBe(first.id);
    expect(rules).toHaveLength(1);
    expect(updated.notification_channels).toEqual(['in_app', 'telegram']);
    expect(updated.metadata.createdFrom).toBe('smart_alerts_page');
    expect(updated.metadata.status).toBe('active');
  });

  it('notifies each matching detection subscription with per-rule dedupe keys', async () => {
    const store = new SmartAlertStore();
    const event = makeDetectionEvent();

    const smartAlertsRule = await store.createDetectionSubscription({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'all',
      threshold: 'Any detection event',
      source: 'smart_alerts_page'
    });
    const detectionPageRule = await store.createDetectionSubscription({
      userId: '22222222-2222-4222-8222-222222222222',
      scope: 'all',
      threshold: 'Any detection event',
      source: 'detection_page'
    });

    await expect(store.notifyDetectionEvent(event)).resolves.toBe(2);
    await expect(store.notifyDetectionEvent(event)).resolves.toBe(0);

    const triggers = await store.listTriggers(10);
    expect(triggers).toHaveLength(2);
    expect(triggers.map((trigger) => trigger.dedupe_key).sort()).toEqual([
      `detection-event:${detectionPageRule.id}:${event.id}`,
      `detection-event:${smartAlertsRule.id}:${event.id}`
    ].sort());
    expect(triggers.find((trigger) => trigger.alert_rule_id === smartAlertsRule.id)?.metadata.alertSource).toBe('smart_alerts_page');
    expect(triggers.find((trigger) => trigger.alert_rule_id === detectionPageRule.id)?.metadata.alertSource).toBe('detection_page');
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function makeDetectionEvent(): DetectionEvent {
  return {
    id: 'event-1',
    eventType: 'Accumulation',
    summary: 'Consistent wallet accumulation observed.',
    sentiment: 'bullish',
    severity: 'medium',
    score: 72,
    detectedAt: Date.now(),
    token: {
      name: 'Example Token',
      ticker: 'EXM',
      address: 'TokenAddress111111111111111111111111111111',
      chain: 'solana',
      pairAddress: 'pair-1'
    },
    metrics: {
      volume24h: 250_000,
      liquidity: 80_000,
      marketCap: 1_000_000,
      priceChange24h: 12,
      netFlow: 20_000
    },
    classificationId: 'classification-1',
    dedupeKey: 'solana:pair-1:ACCUMULATION'
  };
}
