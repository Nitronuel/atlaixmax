import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
