import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Activity,
    ArrowRight,
    Bell,
    CheckCircle2,
    ExternalLink,
    Link2,
    Loader2,
    Mail,
    Plus,
    Radar,
    RefreshCw,
    Search,
    Send,
    ShieldCheck,
    SlidersHorizontal,
    TrendingUp,
    X
} from 'lucide-react';
import {
    SmartAlertCondition,
    SmartAlertRule,
    SmartAlertService,
    SmartAlertTokenSnapshot,
    SmartAlertThresholdKind,
    SmartAlertTrigger,
    SmartAlertType
} from './smart-alert-service';
import { apiUrl } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { TelegramService, type TelegramLink, type TelegramStatus } from '../../services/TelegramService';

interface BasicAlertType {
    id: string;
    title: string;
    desc: string;
    type: SmartAlertType;
    icon: React.ReactNode;
}

interface AlertSetupDraft {
    target: string;
    chainId: string;
    tokenAddress: string;
    condition: SmartAlertCondition;
    thresholdKind: SmartAlertThresholdKind;
    threshold: string;
    notificationChannels: string[];
    expirationMinutes: number | null;
}

interface LinkedConditionDraft extends AlertSetupDraft {
    id: string;
    alertType: SmartAlertType;
    label: string;
}

interface BackendStatus {
    enabled?: boolean;
    running?: boolean;
    lastRunStartedAt?: string | null;
    lastRunCompletedAt?: string | null;
    lastRunStatus?: string;
    lastError?: string;
    rulesChecked?: number;
    triggersCreated?: number;
}

type AlertTableTab = 'all' | 'active' | 'triggered';
type AlertTableStatus = 'active' | 'triggered' | 'paused' | 'expired';
type AlertWizardStep = 'token' | 'mode' | 'type' | 'details' | 'review';

interface AlertTableRow {
    id: string;
    ruleId: string | null;
    triggerId: string | null;
    title: string;
    tokenLabel: string;
    tokenAddress: string | null;
    chainId: string | null;
    type: SmartAlertType;
    conditionText: string;
    status: AlertTableStatus;
    channels: string[];
    source: string;
    lastTriggeredAt: string | null;
    triggerCount: number;
    observedValue: string | null;
    lastError: string | null;
    rule: SmartAlertRule | null;
    trigger: SmartAlertTrigger | null;
}

const BASIC_ALERT_TYPES: BasicAlertType[] = [
    { id: 'price-target', title: 'Price Target', desc: 'Token crosses above or below a selected price.', type: 'Price', icon: <TrendingUp size={18} /> },
    { id: 'price-move', title: '24h Price Move', desc: 'Token price moves by a selected percentage.', type: 'Price', icon: <Activity size={18} /> },
    { id: 'volume', title: '24h Volume', desc: 'Volume crosses a dollar threshold or changes by a percentage.', type: 'Volume', icon: <Activity size={18} /> },
    { id: 'liquidity', title: 'Liquidity', desc: 'Liquidity crosses a dollar threshold or changes by a percentage.', type: 'Liquidity', icon: <ShieldCheck size={18} /> },
    { id: 'detection-event', title: 'Detection Event', desc: 'A Detection Engine event arrives for this token.', type: 'Detection', icon: <Radar size={18} /> }
];

const CONDITION_OPTIONS: Record<SmartAlertType, Array<{ value: SmartAlertCondition; label: string; thresholdKind: SmartAlertThresholdKind }>> = {
    Price: [
        { value: 'above', label: 'Price above', thresholdKind: 'currency' },
        { value: 'below', label: 'Price below', thresholdKind: 'currency' },
        { value: 'changes_by_percent', label: 'Price moves by', thresholdKind: 'percent' }
    ],
    Volume: [
        { value: 'above', label: 'Volume above', thresholdKind: 'currency' },
        { value: 'below', label: 'Volume below', thresholdKind: 'currency' },
        { value: 'changes_by_percent', label: 'Volume changes by', thresholdKind: 'percent' }
    ],
    Liquidity: [
        { value: 'above', label: 'Liquidity above', thresholdKind: 'currency' },
        { value: 'below', label: 'Liquidity below', thresholdKind: 'currency' },
        { value: 'changes_by_percent', label: 'Liquidity changes by', thresholdKind: 'percent' }
    ],
    Whale: [
        { value: 'buy_above', label: 'Buy above', thresholdKind: 'currency' },
        { value: 'sell_above', label: 'Sell above', thresholdKind: 'currency' },
        { value: 'buy_or_sell_above', label: 'Buy or sell above', thresholdKind: 'currency' }
    ],
    Alpha: [
        { value: 'event_is', label: 'Event is', thresholdKind: 'event' }
    ],
    Risk: [
        { value: 'severity_is', label: 'Severity is', thresholdKind: 'severity' }
    ],
    Detection: [
        { value: 'event_is', label: 'Event is', thresholdKind: 'event' },
        { value: 'severity_is', label: 'Severity is', thresholdKind: 'severity' }
    ],
    Wallet: [
        { value: 'event_is', label: 'Wallet activity', thresholdKind: 'event' }
    ]
};

const DETECTION_EVENT_OPTIONS = [
    'Any detection event',
    'Bullish Continuation Pump',
    'Bearish Continuation Dump',
    'Bearish Relief Bounce',
    'Bullish Pullback',
    'Bearish Reversal Attempt',
    'Bullish Breakdown Attempt',
    'Range Breakout Attempt',
    'Range Breakdown Attempt',
    'Low Liquidity Price Spike',
    'Low Liquidity Sell Off',
    'Liquidity Drain',
    'Liquidity Added',
    'Pump',
    'Dump',
    'Buy Recovery',
    'Sell Off',
    'Accumulation',
    'Distribution'
];

const DETECTION_SEVERITY_OPTIONS = ['Any severity', 'Critical', 'High', 'Medium', 'Low'];

const VALUE_OPTIONS: Partial<Record<SmartAlertType, string[]>> = {
    Alpha: [
        'Momentum Breakout',
        'Overextended Momentum',
        'Potential Accumulation',
        'Accumulation',
        'Potential Distribution',
        'Distribution',
        'Market Stress',
        'Possible Wash Trading',
        'Deep Liquidity Structure',
        'Thin Liquidity Risk',
        'Confirmed Liquidity Added',
        'Confirmed Liquidity Removed',
        'Flow Imbalance',
        'Conflicting Signals',
        'Recovery Attempt',
        'Confirmed Recovery',
        'Recovery',
        'Liquidity Event',
        'Market Watch'
    ],
    Risk: ['Any new risk', 'High', 'Medium', 'Low'],
    Detection: DETECTION_EVENT_OPTIONS
};

const SETUP_DEFAULTS: Record<SmartAlertType, AlertSetupDraft> = {
    Price: { target: '', chainId: '', tokenAddress: '', condition: 'above', thresholdKind: 'currency', threshold: '$200', notificationChannels: ['in_app'], expirationMinutes: null },
    Volume: { target: '', chainId: '', tokenAddress: '', condition: 'above', thresholdKind: 'currency', threshold: '$1M', notificationChannels: ['in_app'], expirationMinutes: null },
    Liquidity: { target: '', chainId: '', tokenAddress: '', condition: 'below', thresholdKind: 'currency', threshold: '$100K', notificationChannels: ['in_app'], expirationMinutes: null },
    Whale: { target: '', chainId: '', tokenAddress: '', condition: 'buy_above', thresholdKind: 'currency', threshold: '$50K', notificationChannels: ['in_app'], expirationMinutes: null },
    Alpha: { target: '', chainId: '', tokenAddress: '', condition: 'event_is', thresholdKind: 'event', threshold: 'Liquidity Event', notificationChannels: ['in_app'], expirationMinutes: null },
    Risk: { target: '', chainId: '', tokenAddress: '', condition: 'severity_is', thresholdKind: 'severity', threshold: 'High', notificationChannels: ['in_app'], expirationMinutes: null },
    Detection: { target: '', chainId: '', tokenAddress: '', condition: 'event_is', thresholdKind: 'event', threshold: 'Any detection event', notificationChannels: ['in_app'], expirationMinutes: null },
    Wallet: { target: '', chainId: '', tokenAddress: '', condition: 'event_is', thresholdKind: 'event', threshold: 'Any wallet activity', notificationChannels: ['in_app'], expirationMinutes: null }
};

const EXPIRATION_OPTIONS = [
    { label: 'None', value: 0 },
    { label: '1 day', value: 1440 },
    { label: '1 week', value: 10080 },
    { label: '1 month', value: 43200 }
];

const TIME_WINDOW_OPTIONS = [
    { label: '1h', value: 60 },
    { label: '24h', value: 1440 },
    { label: '7d', value: 10080 },
    { label: 'No limit', value: 0 }
];

const ALERT_TABLE_TABS: Array<{ value: AlertTableTab; label: string }> = [
    { value: 'all', label: 'All Alerts' },
    { value: 'active', label: 'Active' },
    { value: 'triggered', label: 'Triggered' }
];

const ALERT_TYPE_FILTERS: Array<SmartAlertType | 'all'> = ['all', 'Price', 'Volume', 'Liquidity', 'Whale', 'Alpha', 'Risk', 'Detection', 'Wallet'];
const ALERT_WIZARD_STEPS: Array<{ id: AlertWizardStep; label: string }> = [
    { id: 'token', label: 'Token' },
    { id: 'mode', label: 'Mode' },
    { id: 'type', label: 'Type' },
    { id: 'details', label: 'Details' },
    { id: 'review', label: 'Review' }
];

const shortenAddress = (value: string | null | undefined) => {
    if (!value) return 'No address';
    if (value.length <= 14) return value;
    return `${value.slice(0, 6)}...${value.slice(-6)}`;
};

const formatSmartAlertError = (value: unknown, fallback: string) => {
    const message = value instanceof Error ? value.message : String(value || '');
    if (!message) return fallback;
    if (/linked smart alerts are being updated/i.test(message)) return message;
    if (/sign in/i.test(message)) return message;
    if (/supabase|api|provider|configured|configuration|network|fetch|server|database|endpoint|schema|migration|payload/i.test(message)) {
        return fallback;
    }
    return message;
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const formatRelativeTime = (value: string | null | undefined) => {
    if (!value) return 'Never';
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 'Never';
    const diffMs = Date.now() - timestamp;
    if (diffMs < 60_000) return 'Just now';
    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};

const getExpirationDate = (expirationMinutes: number | null | undefined) => {
    if (!expirationMinutes) return null;
    return new Date(Date.now() + expirationMinutes * 60_000).toISOString();
};

const valueOptionsFor = (type: SmartAlertType, thresholdKind: SmartAlertThresholdKind) => {
    if (type === 'Detection' && thresholdKind === 'severity') return DETECTION_SEVERITY_OPTIONS;
    if (type === 'Detection') return DETECTION_EVENT_OPTIONS;
    return VALUE_OPTIONS[type] || null;
};

const defaultThresholdFor = (type: SmartAlertType, thresholdKind: SmartAlertThresholdKind) => {
    if (type === 'Detection' && thresholdKind === 'severity') return 'Any severity';
    if (type === 'Detection') return 'Any detection event';
    if (type === 'Wallet') return 'Any wallet activity';
    if (thresholdKind === 'event') return 'Liquidity Event';
    if (thresholdKind === 'severity') return 'High';
    if (thresholdKind === 'percent') return '20';
    return '$50K';
};

const typeStyle = (type: SmartAlertType) => {
    switch (type) {
        case 'Price':
            return 'border-primary-green/30 bg-primary-green/10 text-primary-green';
        case 'Volume':
            return 'border-primary-blue/30 bg-primary-blue/10 text-primary-blue';
        case 'Liquidity':
            return 'border-primary-purple/30 bg-primary-purple/10 text-primary-purple';
        case 'Whale':
            return 'border-primary-yellow/30 bg-primary-yellow/10 text-primary-yellow';
        case 'Risk':
            return 'border-primary-red/30 bg-primary-red/10 text-primary-red';
        case 'Detection':
            return 'border-primary-green/30 bg-primary-green/10 text-primary-green';
        case 'Wallet':
            return 'border-primary-blue/30 bg-primary-blue/10 text-primary-blue';
        default:
            return 'border-border bg-card-hover text-text-medium';
    }
};

const currencyPattern = /^\$?\d+(?:\.\d+)?\s*[kKmMbB]?$/;
const percentPattern = /^-?\d+(?:\.\d+)?%?$/;
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const isLikelyTokenOrPairAddress = (value: string | null | undefined) => {
    const trimmed = String(value || '').trim();
    return evmAddressPattern.test(trimmed) || solanaAddressPattern.test(trimmed);
};

const validateDraft = (draft: AlertSetupDraft) => {
    if (!draft.target.trim() || !draft.chainId.trim() || !draft.tokenAddress.trim()) return 'Enter a token contract address and wait for Atlaix to identify it.';
    if (!isLikelyTokenOrPairAddress(draft.tokenAddress)) return 'Use a full token contract address, not a ticker or token name.';
    if (!draft.threshold.trim()) return 'Enter a threshold.';
    if (draft.thresholdKind === 'currency' && !currencyPattern.test(draft.threshold.trim())) {
        return 'Use a currency value like $50K, $1.5M, or 50000.';
    }
    if (draft.thresholdKind === 'percent' && !percentPattern.test(draft.threshold.trim())) {
        return 'Use a percentage value like 10% or 25.';
    }
    return null;
};

const getAlertTrigger = (template: BasicAlertType, draft: AlertSetupDraft) => {
    const target = draft.target.trim();
    if (!target) return 'Select a token to preview this alert';

    const conditionLabel = CONDITION_OPTIONS[template.type].find((option) => option.value === draft.condition)?.label.toLowerCase() || draft.condition;
    const value = draft.thresholdKind === 'percent' && !draft.threshold.includes('%')
        ? `${draft.threshold}%`
        : draft.threshold.trim();

    if (template.type === 'Alpha') return `${target} appears with ${value}`;
    if (template.type === 'Risk') return `${target} risk severity is ${value}`;
    if (template.type === 'Detection') {
        if (draft.condition === 'severity_is') return `${target} receives a ${value.toLowerCase()} Detection Engine event`;
        return value.toLowerCase().startsWith('any') ? `Any Detection Engine event arrives for ${target}` : `${value} arrives for ${target}`;
    }
    if (template.type === 'Whale') return `Whale ${conditionLabel} ${value} on ${target}`;
    return `${target} ${conditionLabel} ${value}`;
};

const conditionLabelFor = (type: SmartAlertType, condition: SmartAlertCondition) => {
    return CONDITION_OPTIONS[type]?.find((option) => option.value === condition)?.label || condition.replaceAll('_', ' ');
};

const tokenLabelForRule = (rule: SmartAlertRule) => {
    if (rule.alert_type === 'Wallet') return rule.metadata?.wallet?.label || rule.target || 'Tracked wallet';
    return rule.metadata?.token?.symbol || rule.metadata?.token?.name || rule.target || 'Tracked token';
};

const tokenAddressForRule = (rule: SmartAlertRule) => {
    if (rule.alert_type === 'Wallet') return rule.metadata?.wallet?.address || null;
    return rule.token_address || rule.metadata?.token?.address || null;
};

const tokenLabelForTrigger = (trigger: SmartAlertTrigger) => {
    const wallet = trigger.metadata?.wallet as { label?: string; address?: string } | undefined;
    if (trigger.alert_type === 'Wallet') return wallet?.label || wallet?.address || 'Tracked wallet';
    const token = trigger.metadata?.token as { ticker?: string; symbol?: string; name?: string; address?: string } | undefined;
    const tokenLabel = trigger.metadata?.tokenLabel;
    if (typeof tokenLabel === 'string' && tokenLabel.trim()) return tokenLabel;
    return token?.ticker || token?.symbol || token?.name || 'Tracked token';
};

const tokenAddressForTrigger = (trigger: SmartAlertTrigger) => {
    const wallet = trigger.metadata?.wallet as { address?: string } | undefined;
    if (trigger.alert_type === 'Wallet') return wallet?.address || null;
    const token = trigger.metadata?.token as { address?: string } | undefined;
    const tokenAddress = trigger.metadata?.tokenAddress;
    return typeof tokenAddress === 'string' ? tokenAddress : token?.address || null;
};

const tokenInitial = (label: string) => {
    return (label.trim().charAt(0) || '?').toUpperCase();
};

const statusLabelFor = (status: AlertTableStatus) => {
    if (status === 'triggered') return 'Triggered';
    if (status === 'paused') return 'Paused';
    if (status === 'expired') return 'Expired';
    return 'Active';
};

const statusClassFor = (status: AlertTableStatus) => {
    if (status === 'triggered') return 'is-triggered';
    if (status === 'paused') return 'is-paused';
    if (status === 'expired') return 'is-expired';
    return 'is-active';
};

const sourceLabelFor = (source: string, type: SmartAlertType) => {
    if (source === 'detection-engine') return 'Detection Engine';
    if (source === 'zerion-wallet-webhook') return 'Zerion Wallet';
    if (source === 'smart-alert-runner') return 'Smart Alert';
    return type === 'Detection' ? 'Detection Alert' : 'Smart Alert';
};

export const SmartAlerts: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const linkedTokenProcessedRef = useRef('');
    const assistantSetupProcessedRef = useRef('');
    const retryLoadTimeoutRef = useRef<number | null>(null);
    const [activeTypeKey, setActiveTypeKey] = useState('price-target');
    const [rules, setRules] = useState<SmartAlertRule[]>([]);
    const [triggers, setTriggers] = useState<SmartAlertTrigger[]>([]);
    const [setupType, setSetupType] = useState<BasicAlertType | null>(null);
    const [setupMode, setSetupMode] = useState<'single' | 'linked-condition'>('single');
    const [setupDraft, setSetupDraft] = useState<AlertSetupDraft>(SETUP_DEFAULTS.Price);
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardStep, setWizardStep] = useState<AlertWizardStep>('token');
    const [alertMode, setAlertMode] = useState<'single' | 'linked'>('single');
    const [linkedConditions, setLinkedConditions] = useState<LinkedConditionDraft[]>([]);
    const [showLinkedTypePicker, setShowLinkedTypePicker] = useState(false);
    const [timeWindowMinutes, setTimeWindowMinutes] = useState(1440);
    const [telegramConnected, setTelegramConnected] = useState(false);
    const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
    const [telegramLink, setTelegramLink] = useState<TelegramLink | null>(null);
    const [telegramLoading, setTelegramLoading] = useState(false);
    const [notificationSaving, setNotificationSaving] = useState(false);
    const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
    const [tokenQuery, setTokenQuery] = useState('');
    const [selectedToken, setSelectedToken] = useState<SmartAlertTokenSnapshot | null>(null);
    const [tokenLookupLoading, setTokenLookupLoading] = useState(false);
    const [tokenLookupError, setTokenLookupError] = useState<string | null>(null);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [initialAlertsLoaded, setInitialAlertsLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [authPrompt, setAuthPrompt] = useState<string | null>(null);
    const [alertTableTab, setAlertTableTab] = useState<AlertTableTab>('all');
    const [alertTableSearch, setAlertTableSearch] = useState('');
    const [alertTypeFilter, setAlertTypeFilter] = useState<SmartAlertType | 'all'>('all');

    const loadUserAlerts = useCallback(async (attempt = 0) => {
        if (!user) {
            setRules([]);
            setTriggers([]);
            setInitialAlertsLoaded(true);
            return;
        }

        setLoadingAlerts(true);
        try {
            const [rulesResult, triggersResult] = await Promise.allSettled([
                SmartAlertService.listRules(),
                SmartAlertService.listTriggers(50)
            ]);

            if (rulesResult.status === 'fulfilled') setRules(rulesResult.value);
            if (triggersResult.status === 'fulfilled') setTriggers(triggersResult.value);

            if (rulesResult.status === 'rejected' && triggersResult.status === 'rejected') {
                if (attempt < 3) {
                    if (retryLoadTimeoutRef.current) window.clearTimeout(retryLoadTimeoutRef.current);
                    retryLoadTimeoutRef.current = window.setTimeout(() => {
                        void loadUserAlerts(attempt + 1);
                    }, 900);
                    return;
                }

                setError(formatSmartAlertError(rulesResult.reason, 'Could not load Smart Alerts.'));
                return;
            }

            if (retryLoadTimeoutRef.current) {
                window.clearTimeout(retryLoadTimeoutRef.current);
                retryLoadTimeoutRef.current = null;
            }
            setError(null);
        } finally {
            setInitialAlertsLoaded(true);
            setLoadingAlerts(false);
        }
    }, [user]);

    useEffect(() => {
        if (!authLoading) loadUserAlerts();
    }, [authLoading, loadUserAlerts]);

    useEffect(() => {
        if (authLoading || !user) return;

        const interval = window.setInterval(() => {
            void loadUserAlerts();
        }, 30_000);

        return () => window.clearInterval(interval);
    }, [authLoading, loadUserAlerts, user]);

    useEffect(() => {
        return () => {
            if (retryLoadTimeoutRef.current) window.clearTimeout(retryLoadTimeoutRef.current);
        };
    }, []);

    const refreshTelegramStatus = useCallback(async () => {
        if (!user) {
            setTelegramConnected(false);
            setTelegramStatus(null);
            return false;
        }

        try {
            const status = await TelegramService.getStatus();
            setTelegramConnected(status.connected);
            setTelegramStatus(status);
            if (status.connected) setTelegramLink(null);
            return status.connected;
        } catch {
            setTelegramConnected(false);
            setTelegramStatus(null);
            return false;
        }
    }, [user]);

    useEffect(() => {
        let cancelled = false;
        refreshTelegramStatus().then((connected) => {
            if (cancelled) return;
            setTelegramConnected(connected);
        });
        return () => {
            cancelled = true;
        };
    }, [refreshTelegramStatus]);

    const alertRows = useMemo<AlertTableRow[]>(() => {
        const latestTriggerByRule = new Map<string, SmartAlertTrigger>();
        const sortedTriggers = [...triggers].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
        for (const trigger of sortedTriggers) {
            if (trigger.alert_rule_id && !latestTriggerByRule.has(trigger.alert_rule_id)) {
                latestTriggerByRule.set(trigger.alert_rule_id, trigger);
            }
        }

        const ruleIds = new Set(rules.map((rule) => rule.id));
        const ruleRows = rules.map((rule) => {
            const trigger = latestTriggerByRule.get(rule.id) || null;
            const isLinked = rule.metadata?.alertMode === 'linked';
            const isRecurringWallet = rule.metadata?.alertMode === 'wallet_activity';
            const isTriggered = rule.metadata?.status === 'completed' || Number(rule.trigger_count || 0) > 0 || Boolean(trigger);
            const isExpired = rule.metadata?.status === 'expired';
            const status: AlertTableStatus = isExpired ? 'expired' : isRecurringWallet && rule.enabled ? 'active' : isTriggered ? 'triggered' : rule.enabled ? 'active' : 'paused';
            const conditions = Array.isArray(rule.metadata?.conditions) ? rule.metadata.conditions : [];
            const metCount = conditions.filter((condition) => condition.status === 'met').length;
            const tokenLabel = tokenLabelForRule(rule);
            const conditionText = isLinked
                ? `${metCount}/${conditions.length} linked conditions`
                : `${conditionLabelFor(rule.alert_type, rule.condition)} ${rule.threshold}`.trim();

            return {
                id: `rule:${rule.id}`,
                ruleId: rule.id,
                triggerId: trigger?.id || null,
                title: rule.trigger_label || `${rule.alert_type} Alert`,
                tokenLabel,
                tokenAddress: tokenAddressForRule(rule),
                chainId: rule.chain_id || null,
                type: rule.alert_type,
                conditionText,
                status,
                channels: rule.notification_channels,
                source: isLinked ? 'Linked Alert' : sourceLabelFor(trigger?.source || '', rule.alert_type),
                lastTriggeredAt: trigger?.created_at || rule.last_triggered_at,
                triggerCount: Number(rule.trigger_count || 0),
                observedValue: trigger?.observed_value || rule.last_observed_value,
                lastError: rule.last_error,
                rule,
                trigger
            };
        });

        const triggerRows = sortedTriggers
            .filter((trigger) => !trigger.alert_rule_id || !ruleIds.has(trigger.alert_rule_id))
            .map((trigger) => ({
                id: `trigger:${trigger.id}`,
                ruleId: null,
                triggerId: trigger.id,
                title: trigger.title || `${trigger.alert_type} Alert`,
                tokenLabel: tokenLabelForTrigger(trigger),
                tokenAddress: tokenAddressForTrigger(trigger),
                chainId: trigger.alert_type === 'Wallet'
                    ? ((trigger.metadata?.wallet as { chain?: string } | undefined)?.chain || null)
                    : ((trigger.metadata?.token as { chain?: string } | undefined)?.chain || null),
                type: trigger.alert_type,
                conditionText: trigger.threshold ? `Matched ${trigger.threshold}` : 'Condition matched',
                status: 'triggered' as AlertTableStatus,
                channels: ['in_app'],
                source: sourceLabelFor(trigger.source, trigger.alert_type),
                lastTriggeredAt: trigger.created_at,
                triggerCount: 1,
                observedValue: trigger.observed_value,
                lastError: null,
                rule: null,
                trigger
            }));

        return [...ruleRows, ...triggerRows].sort((left, right) => {
            const leftTime = new Date(left.lastTriggeredAt || left.rule?.updated_at || left.rule?.created_at || '').getTime();
            const rightTime = new Date(right.lastTriggeredAt || right.rule?.updated_at || right.rule?.created_at || '').getTime();
            return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
        });
    }, [rules, triggers]);

    const alertCounts = useMemo(() => ({
        all: alertRows.length,
        active: alertRows.filter((row) => row.status === 'active').length,
        triggered: alertRows.filter((row) => row.status === 'triggered').length
    }), [alertRows]);

    const filteredAlertRows = useMemo(() => {
        const query = alertTableSearch.trim().toLowerCase();
        return alertRows.filter((row) => {
            if (alertTableTab === 'active' && row.status !== 'active') return false;
            if (alertTableTab === 'triggered' && row.status !== 'triggered') return false;
            if (alertTypeFilter !== 'all' && row.type !== alertTypeFilter) return false;
            if (!query) return true;
            return [
                row.title,
                row.tokenLabel,
                row.chainId || '',
                row.type,
                row.conditionText,
                row.source,
                row.observedValue || '',
                row.lastError || ''
            ].some((value) => value.toLowerCase().includes(query));
        });
    }, [alertRows, alertTableSearch, alertTableTab, alertTypeFilter]);
    const telegramChannelEnabled = rules.some((rule) => rule.notification_channels.includes('telegram'));

    const applySelectedToken = (draft: AlertSetupDraft, token: SmartAlertTokenSnapshot | null = selectedToken) => ({
        ...draft,
        target: token?.name || token?.symbol || draft.target,
        chainId: token?.chainId || draft.chainId,
        tokenAddress: token?.address || draft.tokenAddress
    });

    const lookupToken = async (nextAddress?: string, nextChain?: string): Promise<SmartAlertTokenSnapshot | null> => {
        const address = (nextAddress ?? tokenQuery).trim();
        if (!address) {
            setTokenLookupError('Enter a token contract address.');
            return null;
        }
        if (!isLikelyTokenOrPairAddress(address)) {
            setSelectedToken(null);
            setTokenLookupError('Use a full token contract address, not a ticker or token name.');
            return null;
        }

        setTokenLookupLoading(true);
        setTokenLookupError(null);
        try {
            const params = new URLSearchParams({ address });
            const chain = (nextChain || setupDraft.chainId || searchParams.get('chain') || '').trim();
            if (chain) params.set('chain', chain);
            const response = await fetch(apiUrl(`/api/smart-alerts/token-lookup?${params.toString()}`));
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Token lookup failed.');
            const token = payload.token as SmartAlertTokenSnapshot;
            setSelectedToken(token);
            setTokenQuery(token?.address || address);
            return token;
        } catch {
            setSelectedToken(null);
            setTokenLookupError('Could not find that token. Check the address and try again.');
            return null;
        } finally {
            setTokenLookupLoading(false);
        }
    };

    useEffect(() => {
        const linkedTokenAddress = searchParams.get('address') || searchParams.get('token') || '';
        if (!linkedTokenAddress || linkedTokenProcessedRef.current === linkedTokenAddress) return;

        linkedTokenProcessedRef.current = linkedTokenAddress;
        setTokenQuery(linkedTokenAddress);
        if (isLikelyTokenOrPairAddress(linkedTokenAddress)) {
            void lookupToken(linkedTokenAddress, searchParams.get('chain') || '');
        } else {
            setSelectedToken(null);
            setTokenLookupError('Use a full token contract address, not a ticker or token name.');
        }
    }, [searchParams]);

    useEffect(() => {
        if (!setupType) return;

        const address = setupDraft.tokenAddress.trim();
        if (!address) {
            return;
        }
        if (!isLikelyTokenOrPairAddress(address)) {
            setSelectedToken(null);
            return;
        }

        const timer = window.setTimeout(async () => {
            try {
                const params = new URLSearchParams({ address });
                if (setupDraft.chainId.trim()) params.set('chain', setupDraft.chainId.trim());
                const response = await fetch(apiUrl(`/api/smart-alerts/token-lookup?${params.toString()}`));
                const payload = await response.json();
                if (!response.ok || !payload?.token) throw new Error(payload?.error || 'Token lookup failed.');

                const token = payload.token as SmartAlertTokenSnapshot;
                setSelectedToken(token);
                setTokenQuery(token.address || address);
                setSetupDraft((current) => {
                    if (current.tokenAddress.trim() !== address) return current;
                    return {
                        ...current,
                        target: token.name || token.symbol || current.target,
                        chainId: token.chainId || current.chainId,
                        tokenAddress: token.address || address
                    };
                });
            } catch {
                setSelectedToken(null);
                setSetupDraft((current) => {
                    if (current.tokenAddress.trim() !== address) return current;
                    return { ...current, target: '', chainId: '' };
                });
            }
        }, 600);

        return () => window.clearTimeout(timer);
    }, [setupDraft.tokenAddress, setupType]);

    const getDefaultDraft = (item: BasicAlertType): AlertSetupDraft => ({
            ...SETUP_DEFAULTS[item.type],
            condition: item.id === 'price-move' ? 'changes_by_percent' as SmartAlertCondition : SETUP_DEFAULTS[item.type].condition,
            thresholdKind: item.id === 'price-move' ? 'percent' as SmartAlertThresholdKind : SETUP_DEFAULTS[item.type].thresholdKind,
            threshold: item.id === 'price-move' ? '30' : SETUP_DEFAULTS[item.type].threshold
    });

    const getAssistantDraftFromParams = (item: BasicAlertType): AlertSetupDraft => {
        const condition = searchParams.get('condition') as SmartAlertCondition | null;
        const thresholdKind = searchParams.get('thresholdKind') as SmartAlertThresholdKind | null;
        const threshold = searchParams.get('threshold');
        const rawAddress = searchParams.get('address') || searchParams.get('token') || '';
        const address = isLikelyTokenOrPairAddress(rawAddress) ? rawAddress : '';
        const chainParam = searchParams.get('chain') || '';
        const defaultDraft = getDefaultDraft(item);
        const allowedCondition = CONDITION_OPTIONS[item.type].some((option) => option.value === condition);

        return {
            ...defaultDraft,
            tokenAddress: address,
            chainId: chainParam,
            condition: allowedCondition && condition ? condition : defaultDraft.condition,
            thresholdKind: thresholdKind || (allowedCondition && condition
                ? CONDITION_OPTIONS[item.type].find((option) => option.value === condition)?.thresholdKind || defaultDraft.thresholdKind
                : defaultDraft.thresholdKind),
            threshold: threshold || defaultDraft.threshold
        };
    };

    const openAlertWizard = () => {
        void refreshTelegramStatus();
        setWizardOpen(true);
        setWizardStep('token');
        setSetupType(null);
        setSelectedToken(null);
        setTokenQuery('');
        setSetupMode(alertMode === 'linked' ? 'linked-condition' : 'single');
        setSetupDraft({ ...SETUP_DEFAULTS.Price });
        setLinkedConditions([]);
        setShowLinkedTypePicker(false);
        setTokenLookupError(null);
        setFormError(null);
        setError(null);
    };

    const openSetupModal = (item: BasicAlertType) => {
        setActiveTypeKey(item.id);
        setSetupType(item);
        setSetupMode(alertMode === 'linked' ? 'linked-condition' : 'single');
        setSetupDraft(applySelectedToken(getDefaultDraft(item)));
        setWizardOpen(true);
        setWizardStep('details');
        setShowLinkedTypePicker(false);
        setFormError(null);
        setError(null);
    };

    useEffect(() => {
        if (searchParams.get('setup') !== '1') return;

        const setupKey = searchParams.toString();
        if (!setupKey || assistantSetupProcessedRef.current === setupKey) return;
        assistantSetupProcessedRef.current = setupKey;

        const requestedType = searchParams.get('type') || 'price-target';
        const nextType = BASIC_ALERT_TYPES.find((item) => item.id === requestedType) || BASIC_ALERT_TYPES[0];
        setActiveTypeKey(nextType.id);
        setSetupType(nextType);
        const requestedMode = searchParams.get('alertMode') === 'linked' || searchParams.get('linked') === '1' ? 'linked' : 'single';
        const assistantDraft = getAssistantDraftFromParams(nextType);
        setWizardOpen(true);
        setWizardStep(assistantDraft.tokenAddress ? 'details' : 'token');
        setSetupMode(requestedMode === 'linked' ? 'linked-condition' : 'single');
        setAlertMode(requestedMode);
        setSetupDraft(assistantDraft);
        setLinkedConditions(requestedMode === 'linked'
            ? [{
                ...assistantDraft,
                id: `assistant-${Date.now()}`,
                alertType: nextType.type,
                label: getAlertTrigger(nextType, assistantDraft)
            }]
            : []);
        setShowLinkedTypePicker(false);
        setFormError(null);
        setError(null);
    }, [searchParams]);

    const selectSetupType = (itemId: string) => {
        const nextType = BASIC_ALERT_TYPES.find((item) => item.id === itemId);
        if (!nextType) return;

        setActiveTypeKey(nextType.id);
        setSetupType(nextType);
        setWizardStep('details');
        const defaultDraft = getDefaultDraft(nextType);
        setSetupDraft((current) => applySelectedToken({
            ...defaultDraft,
            target: current.target || defaultDraft.target,
            chainId: current.chainId || defaultDraft.chainId,
            tokenAddress: current.tokenAddress || defaultDraft.tokenAddress
        }));
        setShowLinkedTypePicker(false);
        setFormError(null);
    };

    const closeSetupModal = () => {
        setWizardOpen(false);
        setWizardStep('token');
        setSetupType(null);
        setSaving(false);
        setFormError(null);
    };

    const backWizardStep = () => {
        setFormError(null);
        if (wizardStep === 'mode') setWizardStep('token');
        else if (wizardStep === 'type') setWizardStep('mode');
        else if (wizardStep === 'details') setWizardStep('type');
        else if (wizardStep === 'review') setWizardStep('details');
    };

    const continueFromToken = async () => {
        const address = (setupDraft.tokenAddress || tokenQuery).trim();
        const token = await lookupToken(address, setupDraft.chainId || searchParams.get('chain') || '');
        if (!token) return;
        setSetupDraft((current) => applySelectedToken({ ...current, tokenAddress: token.address || address }, token));
        setWizardStep('mode');
        setFormError(null);
    };

    const continueFromMode = () => {
        setSetupMode(alertMode === 'linked' ? 'linked-condition' : 'single');
        setWizardStep('type');
        setFormError(null);
    };

    const continueFromDetails = () => {
        if (!setupType) {
            setFormError('Choose an alert type before continuing.');
            return;
        }

        if (setupMode === 'linked-condition') {
            if (!selectedToken) {
                setFormError('Choose a token before previewing this linked alert.');
                return;
            }
            if (linkedConditions.length < 2) {
                setFormError('Add at least two linked conditions before previewing.');
                return;
            }
            setWizardStep('review');
            setFormError(null);
            return;
        }

        const validationError = validateDraft(setupDraft);
        if (validationError) {
            setFormError(validationError);
            return;
        }
        if (!selectedToken) {
            setFormError('Choose a token before previewing this alert.');
            return;
        }
        setWizardStep('review');
        setFormError(null);
    };

    const addLinkedCondition = () => {
        if (!setupType) return;
        const validationError = validateDraft(setupDraft);
        if (validationError) {
            setFormError(validationError);
            return;
        }

        const label = getAlertTrigger(setupType, setupDraft);
        setLinkedConditions((current) => [
            ...current,
            {
                ...setupDraft,
                id: `${Date.now()}-${current.length}`,
                alertType: setupType.type,
                label
            }
        ]);
        setShowLinkedTypePicker(true);
        setFormError(null);
    };

    const removeLinkedCondition = (id: string) => {
        setLinkedConditions((current) => current.filter((condition) => condition.id !== id));
    };

    const toggleNotificationChannel = async (channel: string) => {
        if (channel === 'telegram' && !telegramConnected) {
            const connected = await refreshTelegramStatus();
            if (!connected) {
                setFormError('Connect Telegram in Settings before using bot alerts.');
                return;
            }
        }

        setSetupDraft((current) => {
            const channels = current.notificationChannels.includes(channel)
                ? current.notificationChannels.filter((item) => item !== channel)
                : [...current.notificationChannels, channel];
            return { ...current, notificationChannels: channels.length ? channels : ['in_app'] };
        });
    };

    const updateCondition = (condition: SmartAlertCondition) => {
        if (!setupType) return;
        const option = CONDITION_OPTIONS[setupType.type].find((item) => item.value === condition);
        setSetupDraft((current) => ({
            ...current,
            condition,
            thresholdKind: option?.thresholdKind || current.thresholdKind,
            threshold: option?.thresholdKind === 'percent'
                ? '20'
                : option?.thresholdKind === 'event'
                    ? defaultThresholdFor(setupType.type, 'event')
                    : option?.thresholdKind === 'severity'
                        ? defaultThresholdFor(setupType.type, 'severity')
                        : current.thresholdKind === 'currency'
                            ? current.threshold
                            : '$50K'
        }));
        setFormError(null);
    };

    const requireLogin = (message: string) => {
        setAuthPrompt(message);
        return false;
    };

    const toggleAlert = async (id: string) => {
        if (!user) {
            requireLogin('Sign in to manage Smart Alerts on your Atlaix account.');
            return;
        }

        const rule = rules.find((item) => item.id === id);
        if (!rule) return;

        const previousRules = rules;
        setRules((current) => current.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item));
        try {
            const updated = await SmartAlertService.setRuleEnabled(id, !rule.enabled);
            setRules((current) => current.map((item) => item.id === id ? updated : item));
        } catch (err) {
            setRules(previousRules);
            setError(formatSmartAlertError(err, 'Could not update alert.'));
        }
    };

    const removeAlert = async (id: string) => {
        if (!user) {
            requireLogin('Sign in to delete saved Smart Alerts from your Atlaix account.');
            return;
        }

        const previousRules = rules;
        setRules((current) => current.filter((item) => item.id !== id));
        try {
            await SmartAlertService.deleteRule(id);
        } catch (err) {
            setRules(previousRules);
            setError(formatSmartAlertError(err, 'Could not delete alert.'));
        }
    };

    const runBackendCheck = useCallback(async () => {
        if (!user) return;

        try {
            let status = await SmartAlertService.runCheck() as BackendStatus;

            for (let attempt = 0; attempt < 8 && status.running; attempt += 1) {
                await sleep(1_500);
                const statusResponse = await fetch(apiUrl('/api/smart-alerts/status'));
                if (!statusResponse.ok) break;
                status = await statusResponse.json() as BackendStatus;
            }

            await loadUserAlerts();
        } catch {
            // Backend checks are operational plumbing; keep the user flow focused on alerts.
        }
    }, [loadUserAlerts, user]);

    const createAlert = async () => {
        if (!setupType) return;
        const validationError = validateDraft(setupDraft);
        if (validationError) {
            setFormError(validationError);
            return;
        }

        if (!selectedToken) {
            setFormError('Choose a token before saving this alert.');
            return;
        }

        if (!user) {
            requireLogin('Sign in to save Smart Alerts on your Atlaix account.');
            return;
        }

        setSaving(true);
        setError(null);
        setFormError(null);
        try {
            const triggerLabel = getAlertTrigger(setupType, setupDraft);
            const isDetectionAlert = setupType.type === 'Detection';
            const created = isDetectionAlert ? await SmartAlertService.createDetectionSubscription({
                scope: 'token',
                chainId: setupDraft.chainId,
                tokenAddress: setupDraft.tokenAddress.trim(),
                tokenName: selectedToken.name,
                tokenSymbol: selectedToken.symbol,
                condition: setupDraft.condition,
                thresholdKind: setupDraft.thresholdKind,
                threshold: setupDraft.threshold.trim(),
                notificationChannels: setupDraft.notificationChannels,
                source: 'smart_alerts_page'
            }) : await SmartAlertService.createRule({
                alertType: setupType.type,
                target: setupDraft.target.trim() || 'Any token',
                chainId: setupDraft.chainId,
                tokenAddress: setupDraft.tokenAddress.trim() || null,
                condition: setupDraft.condition,
                thresholdKind: setupDraft.thresholdKind,
                threshold: setupDraft.thresholdKind === 'percent' && !setupDraft.threshold.includes('%')
                    ? `${setupDraft.threshold}%`
                    : setupDraft.threshold.trim(),
                triggerLabel,
                notificationChannels: setupDraft.notificationChannels,
                cooldownMinutes: 60,
                metadata: {
                    alertMode: 'single',
                    token: selectedToken,
                    status: 'active',
                    expirationMinutes: setupDraft.expirationMinutes,
                    expiresAt: getExpirationDate(setupDraft.expirationMinutes)
                }
            });
            setRules((current) => [created, ...current]);
            closeSetupModal();
            if (!isDetectionAlert) await runBackendCheck();
        } catch (err) {
            setError(formatSmartAlertError(err, 'Could not create alert.'));
        } finally {
            setSaving(false);
        }
    };

    const createLinkedAlert = async () => {
        if (!selectedToken) {
            setFormError('Choose a token before saving this linked alert.');
            return;
        }

        if (linkedConditions.length < 2) {
            setFormError('Add at least two conditions for this linked alert.');
            return;
        }

        if (!user) {
            requireLogin('Sign in to save Smart Alerts on your Atlaix account.');
            return;
        }

        const primaryCondition = linkedConditions[0];
        setSaving(true);
        setError(null);
        setFormError(null);
        try {
            const created = await SmartAlertService.createRule({
                alertType: primaryCondition.alertType,
                target: selectedToken.symbol || primaryCondition.target,
                chainId: selectedToken.chainId || primaryCondition.chainId,
                tokenAddress: selectedToken.address || primaryCondition.tokenAddress || null,
                condition: primaryCondition.condition,
                thresholdKind: primaryCondition.thresholdKind,
                threshold: primaryCondition.thresholdKind === 'percent' && !primaryCondition.threshold.includes('%')
                    ? `${primaryCondition.threshold}%`
                    : primaryCondition.threshold.trim(),
                triggerLabel: `Linked Smart Alert for ${selectedToken.symbol || selectedToken.name}: ${linkedConditions.length} conditions`,
                notificationChannels: setupDraft.notificationChannels,
                cooldownMinutes: 60,
                metadata: {
                    alertMode: 'linked',
                    token: selectedToken,
                    matchLogic: 'all',
                    timeWindowMinutes: timeWindowMinutes || null,
                    status: 'active',
                    conditions: linkedConditions.map((condition) => ({
                        id: condition.id,
                        alertType: condition.alertType,
                        condition: condition.condition,
                        thresholdKind: condition.thresholdKind,
                        threshold: condition.thresholdKind === 'percent' && !condition.threshold.includes('%')
                            ? `${condition.threshold}%`
                            : condition.threshold.trim(),
                        label: condition.label,
                        status: 'pending',
                        metAt: null,
                        observedValue: null,
                        baselineValue: null,
                        lastError: null
                    }))
                }
            });
            setRules((current) => [created, ...current]);
            setLinkedConditions([]);
            setShowLinkedTypePicker(false);
            await runBackendCheck();
            closeSetupModal();
        } catch (err) {
            setError(formatSmartAlertError(err, 'Could not create linked alert.'));
        } finally {
            setSaving(false);
        }
    };

    const handleTelegramConnect = async () => {
        if (!user) {
            requireLogin('Sign in to connect Telegram alert delivery.');
            return;
        }

        setTelegramLoading(true);
        setNotificationMessage(null);
        setError(null);
        try {
            const link = await TelegramService.createLink();
            setTelegramLink(link);
            window.open(link.url, '_blank', 'noopener,noreferrer');
            setNotificationMessage('Telegram link opened. Return here after connecting.');
        } catch (err) {
            setError(formatSmartAlertError(err, 'Could not create Telegram link.'));
        } finally {
            setTelegramLoading(false);
        }
    };

    const refreshNotificationSettings = async () => {
        setTelegramLoading(true);
        setNotificationMessage(null);
        setError(null);
        try {
            const connected = await refreshTelegramStatus();
            setNotificationMessage(connected ? 'Telegram connected.' : 'Telegram is not connected yet.');
        } finally {
            setTelegramLoading(false);
        }
    };

    const handleTelegramChannelToggle = async () => {
        if (!user) {
            requireLogin('Sign in to manage alert delivery channels.');
            return;
        }

        if (!rules.length) {
            setNotificationMessage('Create an alert before changing delivery channels.');
            return;
        }

        const connected = telegramConnected || await refreshTelegramStatus();
        if (!connected) {
            setNotificationMessage('Connect Telegram before turning bot alerts on.');
            return;
        }

        setNotificationSaving(true);
        setNotificationMessage(null);
        setError(null);
        try {
            const enableTelegram = !telegramChannelEnabled;
            const updatedRules = await Promise.all(rules.map((rule) => {
                const currentChannels = rule.notification_channels.length ? rule.notification_channels : ['in_app'];
                const nextChannels = enableTelegram
                    ? Array.from(new Set([...currentChannels, 'telegram']))
                    : currentChannels.filter((channel) => channel !== 'telegram');
                return SmartAlertService.setRuleNotificationChannels(rule.id, nextChannels.length ? nextChannels : ['in_app']);
            }));
            setRules(updatedRules);
            setNotificationMessage(enableTelegram ? 'Telegram alerts turned on.' : 'Telegram alerts turned off.');
        } catch (err) {
            setError(formatSmartAlertError(err, 'Could not update Telegram alert delivery.'));
        } finally {
            setNotificationSaving(false);
        }
    };

    const previewTrigger = setupType ? getAlertTrigger(setupType, setupDraft) : '';
    const setupValueOptions = setupType ? valueOptionsFor(setupType.type, setupDraft.thresholdKind) : null;
    const wizardStepIndex = Math.max(0, ALERT_WIZARD_STEPS.findIndex((step) => step.id === wizardStep));
    const selectedTokenTitle = selectedToken?.symbol || setupDraft.target || selectedToken?.name || 'Selected token';
    const selectedTokenSubtitle = selectedToken?.name && selectedToken?.symbol
        ? selectedToken.name
        : setupDraft.chainId || selectedToken?.chainId || 'Token details';
    const reviewTitle = setupMode === 'linked-condition'
        ? `Linked Smart Alert for ${selectedTokenTitle}`
        : previewTrigger;

    return (
        <div className="smart-alerts-page relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 pb-10 animate-fade-in">
            {error && (
                <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">
                    {error}
                </div>
            )}
            {formError && !wizardOpen && (
                <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">
                    {formError}
                </div>
            )}

            <div className="smart-alert-entry-panel">
                <div>
                    <div className="smart-alert-entry-kicker">
                        <Bell size={16} />
                        Smart alert setup
                    </div>
                    <h3>Create a token alert</h3>
                    <p>Use a guided setup to choose the token, alert type, trigger details, delivery channels, and final preview.</p>
                </div>
                <button type="button" onClick={openAlertWizard} className="smart-alert-entry-button">
                    <Plus size={18} />
                    Add Alert
                </button>
            </div>

            <div className="smart-alert-workspace-grid">
                <section className="green-corner-card smart-alert-table-panel">
                    <div className="smart-alert-table-head">
                        <div>
                            <h3>
                                <Bell size={18} />
                                Alerts
                                {loadingAlerts && initialAlertsLoaded && <Loader2 size={14} className="animate-spin text-primary-green" />}
                            </h3>
                            <p>Manage saved alerts and fired conditions from one workspace.</p>
                        </div>
                        <button type="button" onClick={() => void loadUserAlerts()} className="smart-alert-table-refresh">
                            Refresh
                        </button>
                    </div>

                    <div className="smart-alert-table-toolbar">
                        <div className="smart-alert-table-tabs" role="tablist" aria-label="Alert status">
                            {ALERT_TABLE_TABS.map((tab) => (
                                <button
                                    key={tab.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={alertTableTab === tab.value}
                                    className={alertTableTab === tab.value ? 'active' : ''}
                                    onClick={() => setAlertTableTab(tab.value)}
                                >
                                    <span>{tab.label}</span>
                                    <b>{alertCounts[tab.value]}</b>
                                </button>
                            ))}
                        </div>
                        <div className="smart-alert-table-filters">
                            <label className="smart-alert-table-select">
                                <SlidersHorizontal size={15} />
                                <select value={alertTypeFilter} onChange={(event) => setAlertTypeFilter(event.target.value as SmartAlertType | 'all')}>
                                    {ALERT_TYPE_FILTERS.map((type) => (
                                        <option key={type} value={type}>{type === 'all' ? 'All Types' : type}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="smart-alert-table-search">
                                <Search size={16} />
                                <input value={alertTableSearch} onChange={(event) => setAlertTableSearch(event.target.value)} placeholder="Search alerts..." />
                            </label>
                        </div>
                    </div>

                    {loadingAlerts && !initialAlertsLoaded ? (
                        <div className="smart-alert-table-state">
                            <Loader2 size={18} className="animate-spin text-primary-green" />
                            Loading alerts
                        </div>
                    ) : filteredAlertRows.length ? (
                        <>
                            <div className="smart-alert-table-wrap custom-scrollbar">
                                <table className="smart-alert-table">
                                    <thead>
                                        <tr>
                                            <th>Token / Chain</th>
                                            <th>Type</th>
                                            <th>Condition</th>
                                            <th>Alert</th>
                                            <th>Last Triggered</th>
                                            <th>Status</th>
                                            <th>Channels</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredAlertRows.map((row) => {
                                            const isLinked = row.rule?.metadata?.alertMode === 'linked';
                                            return (
                                                <tr key={row.id}>
                                                    <td>
                                                        <div className="smart-alert-token-cell">
                                                            <span className="smart-alert-token-logo" aria-hidden="true">
                                                                {tokenInitial(row.tokenLabel)}
                                                            </span>
                                                            <div>
                                                                <strong>{row.tokenLabel}</strong>
                                                                <small>{row.chainId || 'Chain unknown'}</small>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td><span className={`smart-alert-type-pill ${typeStyle(row.type)}`}>{isLinked ? 'Linked' : row.type}</span></td>
                                                    <td>
                                                        <strong className="smart-alert-table-condition">{row.conditionText}</strong>
                                                        {row.observedValue && <small>Observed {row.observedValue}</small>}
                                                        {row.lastError && <small className="smart-alert-table-error">{row.lastError}</small>}
                                                    </td>
                                                    <td>
                                                        <div className="smart-alert-table-alert">
                                                            <div>
                                                                <strong>{row.title}</strong>
                                                                <small>{row.source}</small>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td>{formatRelativeTime(row.lastTriggeredAt)}</td>
                                                    <td><span className={`smart-alert-status-pill ${statusClassFor(row.status)}`}>{statusLabelFor(row.status)}</span></td>
                                                    <td><span className="smart-alert-channel-list">{row.channels.map((channel) => channel.replace('_', ' ')).join(', ') || 'In app'}</span></td>
                                                    <td>
                                                        <div className="smart-alert-table-actions">
                                                            <button type="button" disabled={!row.tokenAddress} onClick={() => row.tokenAddress && navigate(`/token/${encodeURIComponent(row.tokenAddress)}${row.chainId ? `?chain=${encodeURIComponent(row.chainId)}` : ''}`)} aria-label="Open asset">
                                                                <ExternalLink size={15} />
                                                            </button>
                                                            {row.ruleId && (
                                                                <button type="button" onClick={() => toggleAlert(row.ruleId || '')} aria-label={row.rule?.enabled ? 'Pause alert' : 'Activate alert'}>
                                                                    <span className={`smart-alert-mini-toggle ${row.rule?.enabled ? 'active' : ''}`} />
                                                                </button>
                                                            )}
                                                            {row.ruleId && (
                                                                <button type="button" className="danger" onClick={() => removeAlert(row.ruleId || '')} aria-label="Remove alert">
                                                                    <X size={15} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    ) : (
                        <div className="smart-alert-table-state">
                            <CheckCircle2 size={24} className="text-text-dark" />
                            <strong>No alerts found</strong>
                            <span>Create an alert or adjust the current filters.</span>
                        </div>
                    )}
                </section>

                <aside className="smart-alert-notification-panel" aria-label="Smart Alert notification settings">
                    <div className="smart-alert-notification-heading">
                        <small>Notifications</small>
                        <h3>Alert channels</h3>
                        <p>Choose where saved Smart Alerts should reach you.</p>
                    </div>

                    <div className="smart-alert-channel-settings">
                        <button className="smart-alert-channel-row is-static" type="button">
                            <span className="smart-alert-channel-icon"><Bell size={16} /></span>
                            <span>In-app notifications</span>
                            <strong>On</strong>
                            <ArrowRight className="smart-alert-channel-arrow" size={15} />
                        </button>
                        <button
                            className="smart-alert-channel-row is-action"
                            type="button"
                            onClick={handleTelegramChannelToggle}
                            disabled={notificationSaving || telegramLoading || loadingAlerts}
                        >
                            <span className="smart-alert-channel-icon"><Send size={16} /></span>
                            <span>Telegram bot</span>
                            <strong className={telegramChannelEnabled && telegramConnected ? '' : 'is-muted'}>
                                {notificationSaving ? 'Saving' : telegramChannelEnabled && telegramConnected ? 'On' : 'Off'}
                            </strong>
                            <ArrowRight className="smart-alert-channel-arrow" size={15} />
                        </button>
                        <button className="smart-alert-channel-row is-disabled" type="button" disabled>
                            <span className="smart-alert-channel-icon"><Mail size={16} /></span>
                            <span>Email alerts</span>
                            <strong>Planned</strong>
                            <ArrowRight className="smart-alert-channel-arrow" size={15} />
                        </button>
                        <button className="smart-alert-channel-row is-disabled" type="button" disabled>
                            <span className="smart-alert-channel-icon"><Link2 size={16} /></span>
                            <span>Webhook</span>
                            <strong>Planned</strong>
                            <ArrowRight className="smart-alert-channel-arrow" size={15} />
                        </button>
                    </div>

                    <div className="smart-alert-notification-account">
                        <span className="smart-alert-channel-icon"><Send size={17} /></span>
                        <div>
                            <strong>{telegramConnected ? (telegramStatus?.telegramUsername || 'Telegram connected') : 'No Telegram account connected'}</strong>
                            <p>{telegramConnected ? 'Bot delivery can be used for saved alert rules.' : 'Connect Telegram before turning bot delivery on.'}</p>
                        </div>
                    </div>

                    <div className="smart-alert-notification-actions">
                        <button type="button" onClick={handleTelegramConnect} disabled={telegramLoading || !user}>
                            <Send size={15} />
                            <span>{telegramLoading ? 'Working...' : telegramConnected ? 'Change account' : 'Connect Telegram'}</span>
                        </button>
                        <button type="button" onClick={refreshNotificationSettings} disabled={telegramLoading || !user}>
                            <RefreshCw size={15} className={telegramLoading ? 'animate-spin' : ''} />
                            <span>Refresh</span>
                        </button>
                    </div>

                    {telegramLink ? (
                        <a className="smart-alert-telegram-link" href={telegramLink.url} target="_blank" rel="noreferrer">
                            <ExternalLink size={15} />
                            <span>Open @{telegramLink.botUsername}</span>
                        </a>
                    ) : null}

                    {notificationMessage ? <div className="smart-alert-notification-note">{notificationMessage}</div> : null}
                </aside>
            </div>

            {wizardOpen && (
                <div className="smart-alert-wizard-overlay fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={closeSetupModal}>
                    <div className="smart-alert-wizard-shell" onClick={(event) => event.stopPropagation()}>
                        <div className="smart-alert-wizard-head">
                            <div className="flex items-start gap-3">
                                <div className={`smart-alert-wizard-icon ${setupType ? typeStyle(setupType.type) : 'border-primary-green/30 bg-primary-green/10 text-primary-green'}`}>
                                    {setupType?.icon || <Bell size={20} />}
                                </div>
                                <div>
                                    <h3>{setupType ? `Set ${setupType.title}` : 'Create Smart Alert'}</h3>
                                    <p>{setupType?.desc || 'Follow the steps to select a token, choose an alert type, add details, and review before saving.'}</p>
                                </div>
                            </div>
                            <button type="button" onClick={closeSetupModal} className="rounded-lg p-2 text-text-dark transition-colors hover:bg-card-hover hover:text-text-light" aria-label="Close alert setup">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="smart-alert-wizard-steps" role="list" aria-label="Alert setup steps">
                            {ALERT_WIZARD_STEPS.map((step, index) => (
                                <div
                                    key={step.id}
                                    role="listitem"
                                    className={`smart-alert-wizard-step ${wizardStep === step.id ? 'active' : ''} ${index < wizardStepIndex ? 'complete' : ''}`}
                                >
                                    <span>{index + 1}</span>
                                    {step.label}
                                </div>
                            ))}
                        </div>

                        <div className="smart-alert-wizard-body custom-scrollbar">
                            {formError && <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">{formError}</div>}

                            {wizardStep === 'token' && (
                                <div className="space-y-5">
                                    <div>
                                        <h4 className="smart-alert-wizard-title">Paste token contract address</h4>
                                        <p className="smart-alert-wizard-copy">The alert engine needs the token or pair address before it can load market data and available conditions.</p>
                                    </div>
                                    <label className="block">
                                        <span className="mb-2 block text-xs font-bold text-text-medium">Token or pair address</span>
                                        <div className="atlaix-search-field px-4">
                                            <Search size={18} className="text-text-medium" />
                                            <input
                                                value={setupDraft.tokenAddress || tokenQuery}
                                                onChange={(event) => {
                                                    const nextValue = event.target.value;
                                                    setTokenQuery(nextValue);
                                                    setTokenLookupError(null);
                                                    setSelectedToken(null);
                                                    setLinkedConditions([]);
                                                    setSetupDraft((current) => ({ ...current, target: '', chainId: '', tokenAddress: nextValue }));
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') void continueFromToken();
                                                }}
                                                className="py-3 font-mono text-sm text-text-light placeholder:text-text-dark"
                                                placeholder="Paste token contract address"
                                            />
                                        </div>
                                        {tokenLookupError && <div className="mt-2 text-xs font-medium text-primary-red">{tokenLookupError}</div>}
                                    </label>
                                    {selectedToken && (
                                        <div className="smart-alert-token-card">
                                            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary-green">
                                                <CheckCircle2 size={14} />
                                                Token identified
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                                <div>
                                                    <span>Token</span>
                                                    <strong>{selectedToken.name || selectedToken.symbol || 'Unknown token'}</strong>
                                                </div>
                                                <div>
                                                    <span>Network</span>
                                                    <strong>{selectedToken.chainId || 'Unknown network'}</strong>
                                                </div>
                                                <div>
                                                    <span>Contract</span>
                                                    <strong className="font-mono">{shortenAddress(selectedToken.address || setupDraft.tokenAddress || tokenQuery)}</strong>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {wizardStep === 'mode' && (
                                <div className="space-y-5">
                                    <div>
                                        <h4 className="smart-alert-wizard-title">Choose setup mode</h4>
                                        <p className="smart-alert-wizard-copy">Use a single alert for one trigger, or a linked alert when multiple conditions must be met together.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        {(['single', 'linked'] as const).map((mode) => (
                                            <button
                                                key={mode}
                                                type="button"
                                                onClick={() => {
                                                    setAlertMode(mode);
                                                    setSetupMode(mode === 'linked' ? 'linked-condition' : 'single');
                                                    setFormError(null);
                                                }}
                                                className={`smart-alert-choice-card ${alertMode === mode ? 'active' : ''}`}
                                            >
                                                <span>{mode === 'single' ? <Bell size={18} /> : <Link2 size={18} />}</span>
                                                <strong>{mode === 'single' ? 'Single Alert' : 'Linked Alert'}</strong>
                                                <small>{mode === 'single' ? 'Save one alert condition for this token.' : 'Combine two or more conditions for this token.'}</small>
                                            </button>
                                        ))}
                                    </div>
                                    {alertMode === 'linked' && (
                                        <div className="rounded-xl border border-border bg-main p-4">
                                            <div className="mb-3 text-xs font-bold text-text-dark">Condition window</div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                {TIME_WINDOW_OPTIONS.map((option) => (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        onClick={() => setTimeWindowMinutes(option.value)}
                                                        className={`rounded-lg border px-3 py-2 text-xs font-bold transition-colors ${timeWindowMinutes === option.value ? 'border-primary-green bg-primary-green/10 text-primary-green' : 'border-border text-text-medium hover:text-text-light'}`}
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {wizardStep === 'type' && (
                                <div className="space-y-5">
                                    <div>
                                        <h4 className="smart-alert-wizard-title">Select alert type</h4>
                                        <p className="smart-alert-wizard-copy">Choose the signal the platform should monitor for {selectedTokenTitle}.</p>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {BASIC_ALERT_TYPES.filter((item) => alertMode === 'single' || item.type !== 'Detection').map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => openSetupModal(item)}
                                                className={`green-corner-card smart-alert-type-card group cursor-pointer rounded-xl border p-5 text-left transition-colors hover:bg-card-hover ${activeTypeKey === item.id ? 'border-primary-green/40 bg-card-hover' : 'border-border bg-card hover:border-text-dark/50'}`}
                                            >
                                                <div className="flex items-start gap-4">
                                                    <div className="rounded-lg border border-border/50 bg-main p-3 text-primary-green">
                                                        {item.icon}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-bold text-text-light group-hover:text-primary-green">{item.title}</h4>
                                                        <p className="mt-1 text-xs leading-relaxed text-text-medium">{item.desc}</p>
                                                        {alertMode === 'linked' && <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary-green"><Plus size={13} /> Add condition</div>}
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {wizardStep === 'details' && setupType && (
                                <div className="space-y-5">
                                    <div className="smart-alert-token-card">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <div>
                                                <span>Token</span>
                                                <strong>{selectedTokenTitle}</strong>
                                            </div>
                                            <div>
                                                <span>Network</span>
                                                <strong>{setupDraft.chainId || selectedToken?.chainId || 'Unknown network'}</strong>
                                            </div>
                                            <div>
                                                <span>Alert type</span>
                                                <strong>{setupType.title}</strong>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <label className="block">
                                            <span className="mb-2 block text-xs font-bold text-text-medium">Condition</span>
                                            <select value={setupDraft.condition} onChange={(event) => updateCondition(event.target.value as SmartAlertCondition)} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
                                                {CONDITION_OPTIONS[setupType.type].map((condition) => <option key={condition.value} value={condition.value}>{condition.label}</option>)}
                                            </select>
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-xs font-bold text-text-medium">
                                                {setupDraft.thresholdKind === 'percent' ? 'Percentage' : setupDraft.thresholdKind === 'event' ? 'Event' : setupDraft.thresholdKind === 'severity' ? 'Severity' : 'Threshold'}
                                            </span>
                                            {setupValueOptions ? (
                                                <select value={setupDraft.threshold} onChange={(event) => setSetupDraft((current) => ({ ...current, threshold: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
                                                    {setupValueOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                                                </select>
                                            ) : (
                                                <div className="relative">
                                                    <input value={setupDraft.threshold} onChange={(event) => setSetupDraft((current) => ({ ...current, threshold: event.target.value }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 pr-10 text-sm font-medium text-text-light outline-none placeholder:text-text-dark focus:border-primary-green/60" placeholder={setupDraft.thresholdKind === 'percent' ? '20' : '$50K'} />
                                                    {setupDraft.thresholdKind === 'percent' && <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-text-medium">%</span>}
                                                </div>
                                            )}
                                        </label>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <label className="block">
                                            <span className="mb-2 block text-xs font-bold text-text-medium">Notify by</span>
                                            <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-main p-2">
                                                <button
                                                    type="button"
                                                    onClick={() => void toggleNotificationChannel('in_app')}
                                                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-bold transition-colors ${setupDraft.notificationChannels.includes('in_app') ? 'border-primary-green/40 bg-primary-green/10 text-primary-green' : 'border-border bg-card text-text-medium hover:text-text-light'}`}
                                                >
                                                    <span>In-app history</span>
                                                    {setupDraft.notificationChannels.includes('in_app') && <CheckCircle2 size={15} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void toggleNotificationChannel('telegram')}
                                                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm font-bold transition-colors ${setupDraft.notificationChannels.includes('telegram') ? 'border-primary-green/40 bg-primary-green/10 text-primary-green' : 'border-border bg-card text-text-medium hover:text-text-light'} ${telegramConnected ? '' : 'opacity-60'}`}
                                                >
                                                    <span>{telegramConnected ? 'Telegram bot' : 'Telegram bot unavailable'}</span>
                                                    {setupDraft.notificationChannels.includes('telegram') && <CheckCircle2 size={15} />}
                                                </button>
                                            </div>
                                        </label>
                                        <label className="block">
                                            <span className="mb-2 block text-xs font-bold text-text-medium">Expiration</span>
                                            <select value={setupDraft.expirationMinutes ?? 0} onChange={(event) => setSetupDraft((current) => ({ ...current, expirationMinutes: Number(event.target.value) || null }))} className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light outline-none focus:border-primary-green/60">
                                                {EXPIRATION_OPTIONS.map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>

                                    <div className="rounded-xl border border-border bg-main p-4">
                                        <div className="text-xs font-bold text-text-dark">Current condition preview</div>
                                        <div className="mt-2 text-sm font-bold text-text-light">{previewTrigger}</div>
                                        <div className="mt-2 text-xs leading-relaxed text-text-medium">
                                            {setupDraft.thresholdKind === 'percent'
                                                ? 'The first check establishes a baseline. Future checks trigger when the value moves by this percentage.'
                                                : 'Saved alerts monitor market data while the local server runs.'}
                                            {setupDraft.expirationMinutes ? ` If it never triggers, this alert expires in ${EXPIRATION_OPTIONS.find((option) => option.value === setupDraft.expirationMinutes)?.label.toLowerCase() || 'the selected time'}.` : ''}
                                        </div>
                                    </div>

                                    {setupMode === 'linked-condition' && (
                                        <div className="rounded-xl border border-border bg-main p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-xs font-bold text-text-dark">Linked conditions</div>
                                                <div className="text-[11px] font-bold text-text-dark">Use all</div>
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                {linkedConditions.length ? linkedConditions.map((condition, index) => (
                                                    <div key={condition.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                                        <div className="flex min-w-0 items-center gap-3">
                                                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-[11px] font-black text-text-medium">{index + 1}</span>
                                                            <div className="truncate text-xs font-bold text-text-light">{condition.label}</div>
                                                        </div>
                                                        <button type="button" onClick={() => removeLinkedCondition(condition.id)} className="rounded-md p-1 text-text-dark transition-colors hover:bg-primary-red/10 hover:text-primary-red" aria-label="Remove linked condition">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                )) : (
                                                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs font-medium text-text-medium">
                                                        Configure this condition, add it, then choose another alert type.
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {setupMode === 'linked-condition' && linkedConditions.length > 0 && (
                                        <div className="rounded-xl border border-border bg-main p-4">
                                            {!showLinkedTypePicker ? (
                                                <button type="button" onClick={() => setShowLinkedTypePicker(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary-green/50 px-4 py-4 text-sm font-bold text-primary-green transition-colors hover:bg-primary-green/10">
                                                    <Plus size={18} />
                                                    Choose another alert type
                                                </button>
                                            ) : (
                                                <div>
                                                    <div className="mb-3 flex items-center justify-between gap-3">
                                                        <div className="text-xs font-bold text-text-dark">Choose next alert type</div>
                                                        <button type="button" onClick={() => setShowLinkedTypePicker(false)} className="rounded-lg p-1 text-text-dark transition-colors hover:bg-card-hover hover:text-text-light" aria-label="Close alert type picker">
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                        {BASIC_ALERT_TYPES.filter((item) => item.type !== 'Detection').map((item) => (
                                                            <button
                                                                key={item.id}
                                                                type="button"
                                                                onClick={() => selectSetupType(item.id)}
                                                                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${setupType.id === item.id ? 'border-primary-green/40 bg-primary-green/10 text-primary-green' : 'border-border bg-card text-text-medium hover:text-text-light'}`}
                                                            >
                                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-main text-primary-green">{item.icon}</span>
                                                                <span className="truncate text-xs font-bold">{item.title}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {wizardStep === 'review' && (
                                <div className="space-y-5">
                                    <div>
                                        <h4 className="smart-alert-wizard-title">Review alert</h4>
                                        <p className="smart-alert-wizard-copy">Confirm the setup before saving it to the monitoring workspace.</p>
                                    </div>
                                    <div className="smart-alert-review-card">
                                        <div>
                                            <span>Token</span>
                                            <strong>{selectedTokenTitle}</strong>
                                            <small>{selectedTokenSubtitle}</small>
                                        </div>
                                        <div>
                                            <span>Setup</span>
                                            <strong>{setupMode === 'linked-condition' ? 'Linked Alert' : setupType?.title || 'Single Alert'}</strong>
                                            <small>{setupMode === 'linked-condition' ? `${linkedConditions.length} conditions must match` : setupType?.desc}</small>
                                        </div>
                                        <div>
                                            <span>Trigger</span>
                                            <strong>{reviewTitle}</strong>
                                            <small>{setupDraft.notificationChannels.map((channel) => channel.replace('_', ' ')).join(', ') || 'In app'}</small>
                                        </div>
                                        <div>
                                            <span>Expiration</span>
                                            <strong>{setupDraft.expirationMinutes ? EXPIRATION_OPTIONS.find((option) => option.value === setupDraft.expirationMinutes)?.label || 'Selected expiry' : 'Never expires'}</strong>
                                            <small>{setupMode === 'linked-condition' ? `Window: ${TIME_WINDOW_OPTIONS.find((option) => option.value === timeWindowMinutes)?.label || 'Any time'}` : 'Single condition alert'}</small>
                                        </div>
                                    </div>
                                    {setupMode === 'linked-condition' && (
                                        <div className="rounded-xl border border-border bg-main p-4">
                                            <div className="mb-3 text-xs font-bold text-text-dark">Linked conditions</div>
                                            <div className="space-y-2">
                                                {linkedConditions.map((condition, index) => (
                                                    <div key={condition.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-[11px] font-black text-text-medium">{index + 1}</span>
                                                        <div className="min-w-0 truncate text-xs font-bold text-text-light">{condition.label}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="smart-alert-wizard-footer">
                            <button type="button" onClick={wizardStep === 'token' ? closeSetupModal : backWizardStep} className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light">
                                {wizardStep === 'token' ? 'Cancel' : 'Back'}
                            </button>

                            {wizardStep === 'token' && (
                                <button type="button" onClick={() => void continueFromToken()} disabled={tokenLookupLoading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                    {tokenLookupLoading && <Loader2 size={16} className="animate-spin" />}
                                    Next
                                </button>
                            )}

                            {wizardStep === 'mode' && (
                                <button type="button" onClick={continueFromMode} className="rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90">
                                    Next
                                </button>
                            )}

                            {wizardStep === 'type' && (
                                <span className="text-xs font-bold text-text-dark">Choose an alert type to continue.</span>
                            )}

                            {wizardStep === 'details' && setupType && (
                                setupMode === 'linked-condition' ? (
                                    <>
                                        <button type="button" onClick={addLinkedCondition} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary-green/40 px-5 py-3 text-sm font-bold text-primary-green transition-colors hover:bg-primary-green/10 disabled:cursor-not-allowed disabled:opacity-60">
                                            <Plus size={16} />
                                            Add Condition
                                        </button>
                                        <button type="button" onClick={continueFromDetails} disabled={saving || linkedConditions.length < 2} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                            Preview Alert
                                        </button>
                                    </>
                                ) : (
                                    <button type="button" onClick={continueFromDetails} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                        Preview Alert
                                    </button>
                                )
                            )}

                            {wizardStep === 'review' && (
                                <button type="button" onClick={setupMode === 'linked-condition' ? createLinkedAlert : createAlert} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    {setupMode === 'linked-condition' ? 'Create Linked Alert' : 'Create Alert'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {authPrompt && (
                <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={() => setAuthPrompt(null)}>
                    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-primary-green/30 bg-primary-green/10 text-primary-green"><Bell size={22} /></div>
                        <h3 className="text-xl font-bold text-text-light">Save this alert</h3>
                        <p className="mt-2 text-sm leading-relaxed text-text-medium">{authPrompt}</p>
                        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button type="button" onClick={() => setAuthPrompt(null)} className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light">Keep browsing</button>
                            <button type="button" onClick={() => navigate('/login', { state: { from: { pathname: '/smart-alerts' } } })} className="rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90">Sign in</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
