import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readEnv } from '../env';
import type { DetectionEvent } from '../../src/shared/detection';
import { sendTelegramAlert } from './telegram';

export type SmartAlertRow = {
  id: string;
  user_id: string;
  alert_type: 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk' | 'Detection';
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
const SUPABASE_TIMEOUT_MS = 12_000;
const RULE_COLUMNS = 'id,user_id,alert_type,target,chain_id,token_address,condition,threshold_kind,threshold,trigger_label,notification_channels,cooldown_minutes,enabled,last_checked_at,last_triggered_at,last_observed_value,last_observed_at,baseline_value,baseline_observed_at,trigger_count,last_error,metadata,created_at,updated_at';
const TRIGGER_COLUMNS = 'id,alert_rule_id,user_id,alert_type,title,message,observed_value,threshold,source,dedupe_key,metadata,created_at';

function getDefaultUserId() {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeChannels(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : ['in_app'];
}

function normalizeRule(row: any): SmartAlertRow {
  const now = new Date().toISOString();
  return {
    id: String(row.id || randomUUID()),
    user_id: String(row.user_id || getDefaultUserId()),
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
    user_id: String(row.user_id || getDefaultUserId()),
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

function normalizeMatchValue(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function detectionRuleMatchesEvent(rule: SmartAlertRow, event: DetectionEvent) {
  const condition = normalizeMatchValue(rule.condition);
  const threshold = normalizeMatchValue(rule.threshold);
  if (!threshold || threshold.startsWith('any')) return true;
  if (condition === 'severity_is') return normalizeMatchValue(event.severity) === threshold;
  return normalizeMatchValue(event.eventType) === threshold || normalizeMatchValue(event.eventType.replaceAll('-', ' ')) === threshold;
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

  private async deliverTrigger(row: SmartAlertTriggerRow) {
    if (!row.alert_rule_id) return;
    try {
      const rule = (await this.listRules(row.user_id)).find((item) => item.id === row.alert_rule_id) || null;
      await sendTelegramAlert(row, rule);
    } catch (error) {
      console.warn('[SmartAlerts] Telegram delivery failed.', error);
    }
  }

  async listRules(userId?: string) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: RULE_COLUMNS,
          order: 'created_at.desc'
        });
        if (userId) params.set('user_id', `eq.${userId}`);
        const rows = await supabaseFetch(`alert_rules?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(normalizeRule) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().rules
      .filter((rule) => !userId || rule.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async listEnabledRules(limit: number) {
    const rules = await this.listRules();
    return rules
      .filter((rule) => rule.enabled)
      .sort((left, right) => String(left.last_checked_at || '').localeCompare(String(right.last_checked_at || '')))
      .slice(0, limit);
  }

  async getDetectionSubscription(userId: string, chainId: string, tokenAddress: string, condition?: string, threshold?: string) {
    const normalizedChain = chainId.trim().toLowerCase();
    const normalizedAddress = tokenAddress.trim().toLowerCase();
    const normalizedCondition = normalizeMatchValue(condition);
    const normalizedThreshold = normalizeMatchValue(threshold);
    const rules = await this.listRules(userId);
    return rules.find((rule) => (
      rule.alert_type === 'Detection' &&
      rule.enabled &&
      rule.metadata?.alertMode === 'detection_event' &&
      rule.metadata?.detectionScope === 'token' &&
      rule.chain_id.toLowerCase() === normalizedChain &&
      String(rule.token_address || '').toLowerCase() === normalizedAddress &&
      (!normalizedCondition || normalizeMatchValue(rule.condition) === normalizedCondition) &&
      (!normalizedThreshold || normalizeMatchValue(rule.threshold) === normalizedThreshold)
    )) || null;
  }

  async createDetectionSubscription(input: {
    userId: string;
    scope: 'all' | 'token';
    chainId?: string;
    tokenAddress?: string;
    tokenName?: string | null;
    tokenSymbol?: string | null;
    condition?: string;
    thresholdKind?: string;
    threshold?: string;
    notificationChannels?: string[];
  }) {
    const scope = input.scope === 'all' ? 'all' : 'token';
    const chainId = (input.chainId || 'all').trim().toLowerCase();
    const tokenAddress = input.tokenAddress?.trim() || null;
    const condition = input.condition === 'severity_is' ? 'severity_is' : 'event_is';
    const thresholdKind = condition === 'severity_is' ? 'severity' : 'event';
    const threshold = input.threshold?.trim() || (condition === 'severity_is' ? 'Any severity' : 'Any detection event');
    const existing = scope === 'token' && tokenAddress
      ? await this.getDetectionSubscription(input.userId, chainId, tokenAddress, condition, threshold)
      : (await this.listRules(input.userId)).find((rule) => (
        rule.alert_type === 'Detection' &&
        rule.enabled &&
        rule.metadata?.alertMode === 'detection_event' &&
        rule.metadata?.detectionScope === 'all' &&
        rule.condition === condition &&
        String(rule.threshold || '').toLowerCase() === threshold.toLowerCase()
      )) || null;
    if (existing) return existing;

    const tokenLabel = input.tokenSymbol || input.tokenName || (tokenAddress ? `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-6)}` : 'all tokens');
    return this.createRule({
      alertType: 'Detection',
      target: scope === 'all' ? 'All Detection Engine events' : tokenLabel,
      chainId,
      tokenAddress,
      condition,
      thresholdKind,
      threshold,
      triggerLabel: scope === 'all' ? `${threshold} on Detection Engine` : `${threshold} for ${tokenLabel}`,
      notificationChannels: input.notificationChannels?.length ? input.notificationChannels : ['in_app'],
      cooldownMinutes: 1,
      metadata: {
        alertMode: 'detection_event',
        detectionScope: scope,
        detectionFilter: {
          condition,
          thresholdKind,
          threshold
        },
        status: 'active',
        token: scope === 'token' ? {
          address: tokenAddress,
          chainId,
          name: input.tokenName || tokenLabel,
          symbol: input.tokenSymbol || tokenLabel
        } : null
      }
    }, input.userId);
  }

  async notifyDetectionEvent(event: DetectionEvent) {
    const rules = (await this.listRules()).filter((rule) => (
      rule.enabled &&
      rule.alert_type === 'Detection' &&
      rule.metadata?.alertMode === 'detection_event' &&
      detectionRuleMatchesEvent(rule, event) &&
      (
        rule.metadata?.detectionScope === 'all' ||
        (
          rule.metadata?.detectionScope === 'token' &&
          String(rule.token_address || '').toLowerCase() === event.token.address.toLowerCase() &&
          String(rule.chain_id || '').toLowerCase() === event.token.chain.toLowerCase()
        )
      )
    ));

    let created = 0;
    const now = new Date().toISOString();
    for (const rule of rules) {
      const inserted = await this.insertTrigger({
        alert_rule_id: rule.id,
        user_id: rule.user_id,
        alert_type: 'Detection',
        title: event.eventType,
        message: `${event.token.ticker || event.token.name || 'Token'}: ${event.summary}`,
        observed_value: event.severity,
        threshold: rule.threshold,
        source: 'detection-engine',
        dedupe_key: `detection-event:${event.id}`,
        metadata: {
          eventId: event.id,
          eventType: event.eventType,
          severity: event.severity,
          sentiment: event.sentiment,
          score: event.score,
          detectedAt: new Date(event.detectedAt).toISOString(),
          token: event.token,
          metrics: event.metrics,
          detectionUrl: `/detection/token/${encodeURIComponent(event.token.chain)}/${encodeURIComponent(event.token.address)}`
        },
        created_at: now
      });
      if (inserted) {
        created += 1;
        await this.updateRule(rule.id, {
          last_checked_at: now,
          last_triggered_at: now,
          last_observed_value: event.severity,
          last_observed_at: now,
          trigger_count: Number(rule.trigger_count || 0) + 1,
          last_error: null
        }, rule.user_id);
      }
    }
    return created;
  }

  async createRule(input: CreateRuleInput, userId = getDefaultUserId()) {
    const now = new Date().toISOString();
    const row = normalizeRule({
      id: randomUUID(),
      user_id: userId,
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

  async updateRule(id: string, patch: Partial<SmartAlertRow>, userId?: string) {
    const nextPatch = { ...patch, updated_at: new Date().toISOString() };
    if (!this.useLocalOnly) {
      try {
        const filters = new URLSearchParams({
          id: `eq.${id}`,
          select: RULE_COLUMNS
        });
        if (userId) filters.set('user_id', `eq.${userId}`);
        const rows = await supabaseFetch(`alert_rules?${filters.toString()}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(nextPatch)
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        if (!row) throw new Error('Smart Alert rule was not found.');
        return normalizeRule(row);
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const index = state.rules.findIndex((rule) => rule.id === id && (!userId || rule.user_id === userId));
    if (index < 0) throw new Error('Smart Alert rule was not found.');
    state.rules[index] = normalizeRule({ ...state.rules[index], ...nextPatch });
    writeLocalState(state);
    return state.rules[index];
  }

  async deleteRule(id: string, userId?: string) {
    if (!this.useLocalOnly) {
      try {
        const filters = new URLSearchParams({ id: `eq.${id}` });
        if (userId) filters.set('user_id', `eq.${userId}`);
        await supabaseFetch(`alert_rules?${filters.toString()}`, { method: 'DELETE' });
        return;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.rules = state.rules.filter((rule) => rule.id !== id || (userId ? rule.user_id !== userId : false));
    writeLocalState(state);
  }

  async listTriggers(limit = 50, userId?: string) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: TRIGGER_COLUMNS,
          order: 'created_at.desc',
          limit: String(limit)
        });
        if (userId) params.set('user_id', `eq.${userId}`);
        const rows = await supabaseFetch(`alert_triggers?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(normalizeTrigger) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().triggers
      .filter((trigger) => !userId || trigger.user_id === userId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, limit);
  }

  async insertTrigger(input: Omit<SmartAlertTriggerRow, 'id' | 'user_id' | 'created_at'> & { user_id?: string; created_at?: string }) {
    const row = normalizeTrigger({
      ...input,
      id: randomUUID(),
      user_id: input.user_id || getDefaultUserId(),
      created_at: input.created_at || new Date().toISOString()
    });

    if (!this.useLocalOnly) {
      try {
        if (row.dedupe_key) {
          const params = new URLSearchParams({
            select: 'id',
            user_id: `eq.${row.user_id}`,
            dedupe_key: `eq.${row.dedupe_key}`,
            limit: '1'
          });
          const existing = await supabaseFetch(`alert_triggers?${params.toString()}`);
          if (Array.isArray(existing) && existing.length) return false;
        }
        const rows = await supabaseFetch('alert_triggers?select=id', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row)
        });
        const inserted = Boolean(Array.isArray(rows) ? rows[0] : rows);
        if (inserted) await this.deliverTrigger(row);
        return inserted;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    if (row.dedupe_key && state.triggers.some((trigger) => trigger.dedupe_key === row.dedupe_key)) return false;
    state.triggers.unshift(row);
    writeLocalState(state);
    await this.deliverTrigger(row);
    return true;
  }
}
