import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readEnv } from '../env';

export type SmartAlertRow = {
  id: string;
  user_id: string;
  alert_type: 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk';
  target: string;
  chain_id: string;
  token_address: string | null;
  condition: string;
  threshold_kind: string;
  threshold: string;
  trigger_label: string;
  notification_channels: string[];
  cooldown_minutes: number;
  enabled: boolean;
  last_checked_at: string | null;
  last_triggered_at: string | null;
  last_observed_value: string | null;
  last_observed_at: string | null;
  baseline_value: number | null;
  baseline_observed_at: string | null;
  trigger_count: number;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type SmartAlertTriggerRow = {
  id: string;
  alert_rule_id: string | null;
  user_id: string;
  alert_type: SmartAlertRow['alert_type'];
  title: string;
  message: string;
  observed_value: string | null;
  threshold: string | null;
  source: string;
  dedupe_key?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type LocalAlertState = {
  rules: SmartAlertRow[];
  triggers: SmartAlertTriggerRow[];
};

const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';
const RULE_COLUMNS = 'id,user_id,alert_type,target,chain_id,token_address,condition,threshold_kind,threshold,trigger_label,notification_channels,cooldown_minutes,enabled,last_checked_at,last_triggered_at,last_observed_value,last_observed_at,baseline_value,baseline_observed_at,trigger_count,last_error,metadata,created_at,updated_at';
const TRIGGER_COLUMNS = 'id,alert_rule_id,user_id,alert_type,title,message,observed_value,threshold,source,dedupe_key,metadata,created_at';

function getUserId() {
  return readEnv('SMART_ALERTS_USER_ID') || LOCAL_USER_ID;
}

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function getLocalPath() {
  return resolve(process.cwd(), '.data', 'smart-alerts.json');
}

function readLocalState(): LocalAlertState {
  const filepath = getLocalPath();
  if (!existsSync(filepath)) return { rules: [], triggers: [] };
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf8')) as LocalAlertState;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers : []
    };
  } catch {
    return { rules: [], triggers: [] };
  }
}

function writeLocalState(state: LocalAlertState) {
  const filepath = getLocalPath();
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(state, null, 2));
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for Smart Alerts.');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase Smart Alerts request failed (${response.status}). ${message}`.trim());
  }

  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

function normalizeChannels(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : ['in_app'];
}

function normalizeRule(row: any): SmartAlertRow {
  const now = new Date().toISOString();
  return {
    id: String(row.id || randomUUID()),
    user_id: String(row.user_id || getUserId()),
    alert_type: row.alert_type || 'Price',
    target: row.target || 'Any token',
    chain_id: row.chain_id || 'solana',
    token_address: row.token_address || null,
    condition: row.condition || 'above',
    threshold_kind: row.threshold_kind || 'currency',
    threshold: row.threshold || '',
    trigger_label: row.trigger_label || '',
    notification_channels: normalizeChannels(row.notification_channels),
    cooldown_minutes: Number(row.cooldown_minutes || 60),
    enabled: Boolean(row.enabled),
    last_checked_at: row.last_checked_at || null,
    last_triggered_at: row.last_triggered_at || null,
    last_observed_value: row.last_observed_value || null,
    last_observed_at: row.last_observed_at || null,
    baseline_value: row.baseline_value === null || row.baseline_value === undefined ? null : Number(row.baseline_value),
    baseline_observed_at: row.baseline_observed_at || null,
    trigger_count: Number(row.trigger_count || 0),
    last_error: row.last_error || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at || now,
    updated_at: row.updated_at || now
  };
}

function normalizeTrigger(row: any): SmartAlertTriggerRow {
  return {
    id: String(row.id || randomUUID()),
    alert_rule_id: row.alert_rule_id || null,
    user_id: String(row.user_id || getUserId()),
    alert_type: row.alert_type || 'Price',
    title: row.title || 'Smart Alert',
    message: row.message || '',
    observed_value: row.observed_value || null,
    threshold: row.threshold || null,
    source: row.source || 'system',
    dedupe_key: row.dedupe_key || null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at || new Date().toISOString()
  };
}

export type CreateRuleInput = {
  alertType: SmartAlertRow['alert_type'];
  target: string;
  chainId: string;
  tokenAddress?: string | null;
  condition: string;
  thresholdKind: string;
  threshold: string;
  triggerLabel: string;
  notificationChannels?: string[];
  cooldownMinutes?: number;
  metadata?: Record<string, unknown>;
};

export class SmartAlertStore {
  private useLocalOnly = false;

  async listRules() {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: RULE_COLUMNS,
          user_id: `eq.${getUserId()}`,
          order: 'created_at.desc'
        });
        const rows = await supabaseFetch(`alert_rules?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(normalizeRule) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().rules.sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async listEnabledRules(limit: number) {
    const rules = await this.listRules();
    return rules
      .filter((rule) => rule.enabled)
      .sort((left, right) => String(left.last_checked_at || '').localeCompare(String(right.last_checked_at || '')))
      .slice(0, limit);
  }

  async createRule(input: CreateRuleInput) {
    const now = new Date().toISOString();
    const row = normalizeRule({
      id: randomUUID(),
      user_id: getUserId(),
      alert_type: input.alertType,
      target: input.target || 'Any token',
      chain_id: input.chainId || 'solana',
      token_address: input.tokenAddress || null,
      condition: input.condition,
      threshold_kind: input.thresholdKind || 'currency',
      threshold: input.threshold,
      trigger_label: input.triggerLabel,
      notification_channels: input.notificationChannels?.length ? input.notificationChannels : ['in_app'],
      cooldown_minutes: input.cooldownMinutes || 60,
      enabled: true,
      metadata: input.metadata || {},
      created_at: now,
      updated_at: now
    });

    if (!this.useLocalOnly) {
      try {
        const rows = await supabaseFetch(`alert_rules?select=${encodeURIComponent(RULE_COLUMNS)}`, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row)
        });
        return normalizeRule(Array.isArray(rows) ? rows[0] : rows);
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.rules.unshift(row);
    writeLocalState(state);
    return row;
  }

  async updateRule(id: string, patch: Partial<SmartAlertRow>) {
    const nextPatch = { ...patch, updated_at: new Date().toISOString() };
    if (!this.useLocalOnly) {
      try {
        const rows = await supabaseFetch(`alert_rules?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(RULE_COLUMNS)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(nextPatch)
        });
        return normalizeRule(Array.isArray(rows) ? rows[0] : rows);
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const index = state.rules.findIndex((rule) => rule.id === id);
    if (index < 0) throw new Error('Smart Alert rule was not found.');
    state.rules[index] = normalizeRule({ ...state.rules[index], ...nextPatch });
    writeLocalState(state);
    return state.rules[index];
  }

  async deleteRule(id: string) {
    if (!this.useLocalOnly) {
      try {
        await supabaseFetch(`alert_rules?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
        return;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.rules = state.rules.filter((rule) => rule.id !== id);
    writeLocalState(state);
  }

  async listTriggers(limit = 50) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: TRIGGER_COLUMNS,
          user_id: `eq.${getUserId()}`,
          order: 'created_at.desc',
          limit: String(limit)
        });
        const rows = await supabaseFetch(`alert_triggers?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(normalizeTrigger) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().triggers
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit);
  }

  async insertTrigger(input: Omit<SmartAlertTriggerRow, 'id' | 'user_id' | 'created_at'> & { user_id?: string; created_at?: string }) {
    const row = normalizeTrigger({
      ...input,
      id: randomUUID(),
      user_id: input.user_id || getUserId(),
      created_at: input.created_at || new Date().toISOString()
    });

    if (!this.useLocalOnly) {
      try {
        const rows = await supabaseFetch('alert_triggers?select=id', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row)
        });
        return Boolean(Array.isArray(rows) ? rows[0] : rows);
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    if (row.dedupe_key && state.triggers.some((trigger) => trigger.dedupe_key === row.dedupe_key)) return false;
    state.triggers.unshift(row);
    writeLocalState(state);
    return true;
  }
}
