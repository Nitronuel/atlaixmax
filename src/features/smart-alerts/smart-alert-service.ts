import { apiUrl } from '../../config';
import { authSupabase } from '../../services/SupabaseClient';

export type SmartAlertType = 'Price' | 'Volume' | 'Liquidity' | 'Whale' | 'Alpha' | 'Risk' | 'Detection';

export type SmartAlertCondition =
    | 'above'
    | 'below'
    | 'changes_by_percent'
    | 'buy_above'
    | 'sell_above'
    | 'buy_or_sell_above'
    | 'event_is'
    | 'severity_is';

export type SmartAlertThresholdKind = 'currency' | 'percent' | 'event' | 'severity';

export interface SmartAlertRule {
    id: string;
    user_id: string;
    alert_type: SmartAlertType;
    target: string;
    chain_id: string;
    token_address: string | null;
    condition: SmartAlertCondition;
    threshold_kind: SmartAlertThresholdKind;
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
    metadata: SmartAlertRuleMetadata;
    created_at: string;
    updated_at: string;
}

export interface SmartAlertTrigger {
    id: string;
    alert_rule_id: string | null;
    user_id: string;
    alert_type: SmartAlertType;
    title: string;
    message: string;
    observed_value: string | null;
    threshold: string | null;
    source: string;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface DetectionAlertSubscriptionInput {
    scope: 'all' | 'token';
    chainId?: string;
    tokenAddress?: string;
    tokenName?: string | null;
    tokenSymbol?: string | null;
    condition?: SmartAlertCondition;
    thresholdKind?: SmartAlertThresholdKind;
    threshold?: string;
}

export interface SmartAlertRuleInput {
    alertType: SmartAlertType;
    target: string;
    chainId: string;
    tokenAddress?: string | null;
    condition: SmartAlertCondition;
    thresholdKind: SmartAlertThresholdKind;
    threshold: string;
    triggerLabel: string;
    notificationChannels: string[];
    cooldownMinutes: number;
    metadata?: SmartAlertRuleMetadata;
}

export interface SmartAlertTokenSnapshot {
    address: string;
    pairAddress: string | null;
    chainId: string;
    name: string;
    symbol: string;
    priceUsd: number | null;
    change24h: number | null;
    volume24h: number | null;
    liquidityUsd: number | null;
    riskLevel: string | null;
    imageUrl?: string | null;
    source?: string;
}

export interface LinkedAlertConditionMetadata {
    id: string;
    alertType: SmartAlertType;
    condition: SmartAlertCondition;
    thresholdKind: SmartAlertThresholdKind;
    threshold: string;
    label: string;
    status?: 'pending' | 'met' | 'expired' | 'error';
    metAt?: string | null;
    observedValue?: string | null;
    baselineValue?: number | null;
    lastError?: string | null;
}

export interface SmartAlertRuleMetadata {
    alertMode?: 'single' | 'linked' | 'detection_event';
    detectionScope?: 'all' | 'token';
    token?: SmartAlertTokenSnapshot | null;
    matchLogic?: 'all';
    timeWindowMinutes?: number | null;
    expirationMinutes?: number | null;
    expiresAt?: string | null;
    status?: 'active' | 'paused' | 'completed' | 'expired';
    conditions?: LinkedAlertConditionMetadata[];
    completedAt?: string | null;
    expiredAt?: string | null;
}

const normalizeChannels = (channels: unknown): string[] => {
    return Array.isArray(channels)
        ? channels.map((channel) => String(channel)).filter(Boolean)
        : ['in_app'];
};

const normalizeRule = (row: any): SmartAlertRule => ({
    id: row.id,
    user_id: row.user_id,
    alert_type: row.alert_type,
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
    created_at: row.created_at || new Date().toISOString(),
    updated_at: row.updated_at || new Date().toISOString()
});

const normalizeTrigger = (row: any): SmartAlertTrigger => ({
    id: row.id,
    alert_rule_id: row.alert_rule_id || null,
    user_id: row.user_id,
    alert_type: row.alert_type,
    title: row.title || 'Smart Alert',
    message: row.message || '',
    observed_value: row.observed_value || null,
    threshold: row.threshold || null,
    source: row.source || 'system',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at || new Date().toISOString()
});

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const { data } = authSupabase ? await authSupabase.auth.getSession() : { data: { session: null } };
    const accessToken = data.session?.access_token;
    const response = await fetch(apiUrl(path), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(init?.headers || {})
        }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Smart Alerts request failed.');
    }
    return payload as T;
}

export const SmartAlertService = {
    listRules: async (): Promise<SmartAlertRule[]> => {
        const payload = await requestJson<{ rules: unknown[] }>('/api/smart-alerts/rules');
        return (payload.rules || []).map(normalizeRule);
    },

    createRule: async (input: SmartAlertRuleInput): Promise<SmartAlertRule> => {
        const payload = await requestJson<{ rule: unknown }>('/api/smart-alerts/rules', {
            method: 'POST',
            body: JSON.stringify(input)
        });
        return normalizeRule(payload.rule);
    },

    setRuleEnabled: async (ruleId: string, enabled: boolean): Promise<SmartAlertRule> => {
        const payload = await requestJson<{ rule: unknown }>(`/api/smart-alerts/rules/${encodeURIComponent(ruleId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ enabled })
        });
        return normalizeRule(payload.rule);
    },

    deleteRule: async (ruleId: string): Promise<void> => {
        await requestJson(`/api/smart-alerts/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });
    },

    listTriggers: async (limit = 25): Promise<SmartAlertTrigger[]> => {
        const params = new URLSearchParams({ limit: String(limit) });
        const payload = await requestJson<{ triggers: unknown[] }>(`/api/smart-alerts/triggers?${params.toString()}`);
        return (payload.triggers || []).map(normalizeTrigger);
    },

    getDetectionSubscription: async (chainId: string, tokenAddress: string): Promise<SmartAlertRule | null> => {
        const params = new URLSearchParams({ chain: chainId, address: tokenAddress });
        const payload = await requestJson<{ subscription: unknown | null }>(`/api/smart-alerts/detection-subscription?${params.toString()}`);
        return payload.subscription ? normalizeRule(payload.subscription) : null;
    },

    createDetectionSubscription: async (input: DetectionAlertSubscriptionInput): Promise<SmartAlertRule> => {
        const payload = await requestJson<{ subscription: unknown }>('/api/smart-alerts/detection-subscriptions', {
            method: 'POST',
            body: JSON.stringify(input)
        });
        return normalizeRule(payload.subscription);
    }
};
