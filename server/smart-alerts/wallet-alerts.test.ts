import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWalletActivityAlert, processWalletWebhook } from './wallet-alerts';
import type { CreateRuleInput, SmartAlertRow } from './store';
import { SmartAlertStore } from './store';

describe('wallet activity alerts', () => {
  const originalCwd = process.cwd();
  const originalCallbackUrl = process.env.ZERION_WEBHOOK_CALLBACK_URL;
  const originalApiKey = process.env.ZERION_API_KEY;
  const originalSkipSignature = process.env.ZERION_WEBHOOK_SKIP_SIGNATURE;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'atlaix-wallet-alerts-'));
    process.chdir(workspace);
    delete process.env.ZERION_WEBHOOK_CALLBACK_URL;
    delete process.env.ZERION_API_KEY;
    delete process.env.ZERION_WEBHOOK_SKIP_SIGNATURE;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    restoreEnv('ZERION_WEBHOOK_CALLBACK_URL', originalCallbackUrl);
    restoreEnv('ZERION_API_KEY', originalApiKey);
    restoreEnv('ZERION_WEBHOOK_SKIP_SIGNATURE', originalSkipSignature);
    restoreEnv('TELEGRAM_BOT_TOKEN', originalTelegramBotToken);
    restoreEnv('SUPABASE_URL', originalSupabaseUrl);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalSupabaseServiceRoleKey);
    restoreEnv('SUPABASE_SERVICE_KEY', originalSupabaseServiceKey);
    if (workspace) rmSync(workspace, { recursive: true, force: true });
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

  it('normalizes zero cooldown requests before creating the rule', async () => {
    const store = makeStore();

    const result = await createWalletActivityAlert(store as any, {
      address: '0x2222222222222222222222222222222222222222',
      chain: 'ethereum',
      eventTypes: ['any'],
      notificationChannels: ['in_app'],
      ignoreSpam: true,
      cooldownMinutes: 0
    }, 'user-1');

    expect(store.created?.cooldownMinutes).toBe(1);
    expect(result.rule.cooldown_minutes).toBe(1);
  });

  it('creates an Intelligence Monitor trigger and sends Telegram for matching wallet activity', async () => {
    process.env.ZERION_WEBHOOK_SKIP_SIGNATURE = 'true';
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    const userId = '11111111-1111-4111-8111-111111111111';
    const walletAddress = '0x3333333333333333333333333333333333333333';
    const telegramCalls: Array<{ url: string; body: any }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      telegramCalls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null
      });
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    });
    writeTelegramConnection(userId, 'chat-123');

    const store = new SmartAlertStore();
    const { rule } = await createWalletActivityAlert(store, {
      address: walletAddress,
      chain: 'ethereum',
      label: 'Tracked wallet',
      eventTypes: ['any'],
      notificationChannels: ['in_app', 'telegram'],
      ignoreSpam: true
    }, userId);

    const result = await processWalletWebhook(store, JSON.stringify(makeWalletWebhook(walletAddress)), {});
    const triggers = await store.listTriggers(10, userId);
    const updatedRules = await store.listRules(userId);
    const updatedRule = updatedRules.find((item) => item.id === rule.id);

    expect(result).toEqual({ received: 1, triggersCreated: 1 });
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      alert_rule_id: rule.id,
      user_id: userId,
      alert_type: 'Wallet',
      title: 'Wallet buy',
      source: 'zerion-wallet-webhook',
      observed_value: 'confirmed'
    });
    expect(triggers[0].metadata.alertSource).toBe('wallet_activity');
    expect(triggers[0].metadata.wallet).toMatchObject({ address: walletAddress, chain: 'Ethereum' });
    expect(updatedRule?.trigger_count).toBe(1);
    expect(updatedRule?.last_error).toBeNull();
    expect(telegramCalls).toHaveLength(1);
    expect(telegramCalls[0].url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage');
    expect(telegramCalls[0].body.chat_id).toBe('chat-123');
    expect(telegramCalls[0].body.text).toContain('Atlaix Wallet Alert');
    expect(telegramCalls[0].body.text).toContain('Tracked wallet buy on Ethereum');
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

function writeTelegramConnection(userId: string, chatId: string) {
  const directory = join(process.cwd(), '.data');
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const now = new Date('2026-07-06T10:00:00Z').toISOString();
  writeFileSync(join(directory, 'telegram-connections.json'), JSON.stringify({
    connections: [{
      id: 'telegram-connection-1',
      user_id: userId,
      telegram_chat_id: chatId,
      telegram_user_id: 'telegram-user-1',
      telegram_username: 'atlaix_user',
      link_token_hash: null,
      link_token_expires_at: null,
      connected_at: now,
      disconnected_at: null,
      created_at: now,
      updated_at: now
    }]
  }, null, 2));
}

function makeWalletWebhook(walletAddress: string) {
  return {
    data: {
      attributes: {
        address: walletAddress
      }
    },
    included: [{
      id: 'tx-1',
      type: 'transactions',
      relationships: {
        chain: {
          data: {
            id: 'ethereum'
          }
        }
      },
      attributes: {
        hash: '0xtransaction1',
        operation_type: 'trade',
        status: 'confirmed',
        mined_at: '2026-07-06T10:05:00Z',
        deleted: false,
        flags: {
          is_trash: false
        },
        application_metadata: {
          name: 'Example DEX'
        },
        transfers: [{
          direction: 'out',
          fungible_info: {
            symbol: 'USDC',
            name: 'USD Coin'
          },
          quantity: {
            float: 100
          }
        }, {
          direction: 'in',
          fungible_info: {
            symbol: 'ABC',
            name: 'Example Token'
          },
          quantity: {
            float: 25
          }
        }]
      }
    }]
  };
}
