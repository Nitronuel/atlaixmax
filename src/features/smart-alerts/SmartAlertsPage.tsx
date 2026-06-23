import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Activity,
    AlertTriangle,
    Bell,
    CheckCircle2,
    Clock,
    Flame,
    Link2,
    Loader2,
    Plus,
    Radar,
    Search,
    ShieldCheck,
    TrendingUp,
    Wallet,
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

const BASIC_ALERT_TYPES: BasicAlertType[] = [
    { id: 'price-target', title: 'Price Target', desc: 'Token crosses above or below a selected price.', type: 'Price', icon: <TrendingUp size={18} /> },
    { id: 'price-move', title: '24h Price Move', desc: 'Token price moves by a selected percentage.', type: 'Price', icon: <Activity size={18} /> },
    { id: 'volume', title: '24h Volume', desc: 'Volume crosses a dollar threshold or changes by a percentage.', type: 'Volume', icon: <Activity size={18} /> },
    { id: 'liquidity', title: 'Liquidity', desc: 'Liquidity crosses a dollar threshold or changes by a percentage.', type: 'Liquidity', icon: <ShieldCheck size={18} /> },
    { id: 'whale', title: 'Whale Flow', desc: 'Large buy or sell activity crosses a dollar threshold.', type: 'Whale', icon: <Wallet size={18} /> },
    { id: 'alpha', title: 'Live Alpha Event', desc: 'A token appears with a selected Live Alpha event.', type: 'Alpha', icon: <Flame size={18} /> },
    { id: 'risk', title: 'Risk Severity', desc: 'A token appears with a selected risk severity.', type: 'Risk', icon: <ShieldCheck size={18} /> },
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
    Detection: { target: '', chainId: '', tokenAddress: '', condition: 'event_is', thresholdKind: 'event', threshold: 'Any detection event', notificationChannels: ['in_app'], expirationMinutes: null }
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

const shortenAddress = (value: string | null | undefined) => {
    if (!value) return 'No address';
    if (value.length <= 14) return value;
    return `${value.slice(0, 6)}...${value.slice(-6)}`;
};

const formatLinkedConditionStatus = (status: string | null | undefined) => {
    if (status === 'met') return 'Met';
    if (status === 'error') return 'Needs attention';
    return 'Waiting';
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
    if (thresholdKind === 'event') return 'Liquidity Event';
    if (thresholdKind === 'severity') return 'High';
    if (thresholdKind === 'percent') return '20';
    return '$50K';
};

const formatExpiration = (value: string | null | undefined) => {
    if (!value) return 'No expiration';
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return 'No expiration';
    if (timestamp <= Date.now()) return 'Expired';
    const diffMs = timestamp - Date.now();
    const minutes = Math.ceil(diffMs / 60_000);
    if (minutes < 60) return `Expires in ${minutes}m`;
    const hours = Math.ceil(minutes / 60);
    if (hours < 24) return `Expires in ${hours}h`;
    return `Expires in ${Math.ceil(hours / 24)}d`;
};

const formatWaitingState = (rule: SmartAlertRule) => {
    if (rule.last_error || rule.last_observed_value || !rule.enabled) return null;
    if (rule.alert_type === 'Alpha') return `Waiting for ${rule.threshold}`;
    return null;
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
        default:
            return 'border-border bg-card-hover text-text-medium';
    }
};

const alertIcon = (type: SmartAlertType) => {
    switch (type) {
        case 'Price': return <TrendingUp size={18} />;
        case 'Whale': return <Wallet size={18} />;
        case 'Liquidity': return <ShieldCheck size={18} />;
        case 'Alpha': return <Flame size={18} />;
        case 'Risk': return <AlertTriangle size={18} />;
        case 'Detection': return <Radar size={18} />;
        default: return <Activity size={18} />;
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
    const [alertMode, setAlertMode] = useState<'single' | 'linked'>('single');
    const [linkedConditions, setLinkedConditions] = useState<LinkedConditionDraft[]>([]);
    const [showLinkedTypePicker, setShowLinkedTypePicker] = useState(false);
    const [timeWindowMinutes, setTimeWindowMinutes] = useState(1440);
    const [tokenQuery, setTokenQuery] = useState('');
    const [selectedToken, setSelectedToken] = useState<SmartAlertTokenSnapshot | null>(null);
    const [tokenLookupLoading, setTokenLookupLoading] = useState(false);
    const [tokenLookupError, setTokenLookupError] = useState<string | null>(null);
    const [setupTokenLookupLoading, setSetupTokenLookupLoading] = useState(false);
    const [setupTokenLookupError, setSetupTokenLookupError] = useState<string | null>(null);
    const [loadingAlerts, setLoadingAlerts] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [authPrompt, setAuthPrompt] = useState<string | null>(null);

    const loadUserAlerts = useCallback(async (attempt = 0) => {
        if (!user) {
            setRules([]);
            setTriggers([]);
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

    const feedItems = useMemo(() => (
        rules.filter((rule) => {
            if (rule.metadata?.status === 'completed' || rule.metadata?.status === 'expired') return false;
            if (rule.metadata?.alertMode !== 'linked' && Number(rule.trigger_count || 0) > 0) return false;
            return true;
        })
    ), [rules]);
    const historyItems = useMemo(() => triggers, [triggers]);

    const applySelectedToken = (draft: AlertSetupDraft, token: SmartAlertTokenSnapshot | null = selectedToken) => ({
        ...draft,
        target: token?.name || token?.symbol || draft.target,
        chainId: token?.chainId || draft.chainId,
        tokenAddress: token?.address || draft.tokenAddress
    });

    const lookupToken = async (nextAddress?: string) => {
        const address = (nextAddress ?? tokenQuery).trim();
        if (!address) {
            setTokenLookupError('Enter a token contract address.');
            return;
        }
        if (!isLikelyTokenOrPairAddress(address)) {
            setSelectedToken(null);
            setTokenLookupError('Use a full token contract address, not a ticker or token name.');
            return;
        }

        setTokenLookupLoading(true);
        setTokenLookupError(null);
        try {
            const params = new URLSearchParams({ address });
            const response = await fetch(apiUrl(`/api/smart-alerts/token-lookup?${params.toString()}`));
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Token lookup failed.');
            setSelectedToken(payload.token);
            setTokenQuery(payload.token?.address || address);
        } catch {
            setSelectedToken(null);
            setTokenLookupError('Could not find that token. Check the address and try again.');
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
            void lookupToken(linkedTokenAddress);
        } else {
            setSelectedToken(null);
            setTokenLookupError('Use a full token contract address, not a ticker or token name.');
        }
    }, [searchParams]);

    useEffect(() => {
        if (!setupType) return;

        const address = setupDraft.tokenAddress.trim();
        if (!address) {
            setSetupTokenLookupLoading(false);
            setSetupTokenLookupError(null);
            return;
        }
        if (!isLikelyTokenOrPairAddress(address)) {
            setSetupTokenLookupLoading(false);
            setSelectedToken(null);
            setSetupTokenLookupError('Use a full token contract address, not a ticker or token name.');
            return;
        }

        const timer = window.setTimeout(async () => {
            setSetupTokenLookupLoading(true);
            setSetupTokenLookupError(null);
            try {
                const params = new URLSearchParams({ address });
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
                setSetupTokenLookupError('Could not find a token for that contract address.');
            } finally {
                setSetupTokenLookupLoading(false);
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

    const openSetupModal = (item: BasicAlertType) => {
        setActiveTypeKey(item.id);
        setSetupType(item);
        setSetupMode(alertMode === 'linked' ? 'linked-condition' : 'single');
        setSetupDraft(applySelectedToken(getDefaultDraft(item)));
        setShowLinkedTypePicker(false);
        setSetupTokenLookupError(null);
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
        setSetupTokenLookupError(null);
        setFormError(null);
        setError(null);
    }, [searchParams]);

    const selectSetupType = (itemId: string) => {
        const nextType = BASIC_ALERT_TYPES.find((item) => item.id === itemId);
        if (!nextType) return;

        setActiveTypeKey(nextType.id);
        setSetupType(nextType);
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
        setSetupType(null);
        setSaving(false);
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
            const response = await fetch(apiUrl('/api/smart-alerts/run'), { method: 'POST' });
            if (!response.ok) return;
            let status = await response.json() as BackendStatus;

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
                threshold: setupDraft.threshold.trim()
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

    const createAllDetectionAlert = async () => {
        if (!user) {
            requireLogin('Sign in to save Detection Engine alerts on your Atlaix account.');
            return;
        }

        setSaving(true);
        setError(null);
        setFormError(null);
        try {
            const created = await SmartAlertService.createDetectionSubscription({ scope: 'all' });
            setRules((current) => current.some((rule) => rule.id === created.id) ? current : [created, ...current]);
        } catch (err) {
            setError(formatSmartAlertError(err, 'Could not create detection alert.'));
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
                notificationChannels: ['in_app'],
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

    const previewTrigger = setupType ? getAlertTrigger(setupType, setupDraft) : '';
    const setupValueOptions = setupType ? valueOptionsFor(setupType.type, setupDraft.thresholdKind) : null;

    return (
        <div className="smart-alerts-page relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6 pb-10 animate-fade-in">
            {error && (
                <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">
                    {error}
                </div>
            )}
            {formError && !setupType && (
                <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">
                    {formError}
                </div>
            )}

            <div className="smart-alert-setup-panel">
                <div className="smart-alert-setup-copy">
                    <div>Select token for this alert</div>
                </div>
                <div className="smart-alert-search-row">
                    <div className="smart-alert-search-control">
                        <Search size={20} />
                        <input
                            value={tokenQuery}
                            onChange={(event) => {
                                setTokenQuery(event.target.value);
                                setSelectedToken(null);
                                setLinkedConditions([]);
                                setTokenLookupError(null);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') lookupToken();
                            }}
                            placeholder="Paste token contract address"
                        />
                    </div>
                    <button type="button" onClick={() => void lookupToken()} disabled={tokenLookupLoading} className="smart-alert-search-button">
                        {tokenLookupLoading ? <Loader2 size={20} className="spin" /> : <Search size={20} />}
                        Search
                    </button>
                </div>
                {tokenLookupError && <div className="mt-3 text-xs font-medium text-primary-red">{tokenLookupError}</div>}
                {selectedToken && (
                    <div className="mt-4 rounded-xl border border-primary-green/30 bg-primary-green/10 p-4">
                        <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary-green">
                            <CheckCircle2 size={14} />
                            Token identified
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                                <div className="text-xs font-bold text-text-dark">Token name</div>
                                <div className="mt-1 truncate text-sm font-bold text-text-light">{selectedToken.name || selectedToken.symbol || 'Unknown token'}</div>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-text-dark">Token network</div>
                                <div className="mt-1 truncate text-sm font-bold text-text-light">{selectedToken.chainId || 'Unknown network'}</div>
                            </div>
                            <div>
                                <div className="text-xs font-bold text-text-dark">Contract</div>
                                <div className="mt-1 font-mono text-sm font-bold text-text-light">{shortenAddress(selectedToken.address || tokenQuery)}</div>
                            </div>
                        </div>
                    </div>
                )}
                <div className="smart-alert-mode-row">
                    <div className="smart-alert-mode-tabs">
                        {(['single', 'linked'] as const).map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                onClick={() => {
                                    setAlertMode(mode);
                                    setFormError(null);
                                }}
                                className={alertMode === mode ? 'active' : ''}
                            >
                                {mode === 'single' ? 'Single Alert' : 'Linked Alert'}
                            </button>
                        ))}
                    </div>
                    {alertMode === 'linked' && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-text-dark">Window</span>
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
                    )}
                    <button type="button" onClick={createAllDetectionAlert} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary-green/40 px-3 py-2 text-xs font-bold text-primary-green transition-colors hover:bg-primary-green/10 disabled:cursor-not-allowed disabled:opacity-60">
                        <Radar size={15} />
                        Watch all detection events
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="flex flex-col gap-6 lg:col-span-2">
                    <div className="flex flex-col gap-3">
                        <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                            <Bell size={18} className="text-primary-green" />
                            Alert Types
                        </h3>
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

                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                                <Bell size={18} />
                                Saved Alerts
                            </h3>
                            <button type="button" onClick={() => void loadUserAlerts()} className="text-xs font-bold text-text-dark hover:text-text-light">
                                Refresh
                            </button>
                        </div>

                        <div className="green-corner-card overflow-hidden rounded-xl border border-border bg-card">
                            <div className="custom-scrollbar max-h-[560px] overflow-y-auto">
                                {loadingAlerts ? (
                                    <div className="flex min-h-[180px] items-center justify-center gap-3 text-sm text-text-medium">
                                        <Loader2 size={18} className="animate-spin text-primary-green" />
                                        Loading saved alerts
                                    </div>
                                ) : feedItems.length ? (
                                    feedItems.map((rule) => {
                                        const isLinked = rule.metadata?.alertMode === 'linked';
                                        const conditions = rule.metadata?.conditions || [];
                                        const metCount = conditions.filter((condition) => condition.status === 'met').length;
                                        const waitingState = formatWaitingState(rule);
                                        return (
                                        <div key={rule.id} className={`flex flex-col gap-3 border-b border-border/50 p-4 last:border-0 md:flex-row md:items-center md:justify-between ${!rule.enabled ? 'opacity-60' : ''}`}>
                                            <div className="flex min-w-0 items-start gap-4">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-main text-primary-green">
                                                    {isLinked ? <Link2 size={18} /> : alertIcon(rule.alert_type)}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-bold text-text-light">{rule.trigger_label}</div>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeStyle(rule.alert_type)}`}>{isLinked ? 'Linked' : rule.alert_type}</span>
                                                        <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{rule.metadata?.status === 'completed' ? 'Completed' : rule.metadata?.status === 'expired' ? 'Expired' : rule.enabled ? 'Active' : 'Paused'}</span>
                                                        <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{rule.chain_id}</span>
                                                        {rule.metadata?.token?.symbol && <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{rule.metadata.token.symbol}</span>}
                                                    </div>
                                                    {isLinked && (
                                                        <div className="mt-3 space-y-2">
                                                            <div className="text-[11px] font-bold text-text-medium">{metCount} / {conditions.length} conditions met</div>
                                                            <div className="space-y-1">
                                                                {conditions.map((condition) => (
                                                                    <div key={condition.id} className="flex items-center gap-2 text-[11px] text-text-medium">
                                                                        <span className={`h-2 w-2 shrink-0 rounded-full ${condition.status === 'met' ? 'bg-primary-green' : condition.status === 'error' ? 'bg-primary-red' : 'bg-text-dark'}`} />
                                                                        <span className="truncate">{condition.label}</span>
                                                                        <span className="ml-auto shrink-0 text-text-dark">{formatLinkedConditionStatus(condition.status)}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] text-text-dark sm:grid-cols-3">
                                                        <span>Last checked: {formatRelativeTime(rule.last_checked_at)}</span>
                                                        <span>Last triggered: {formatRelativeTime(rule.last_triggered_at)}</span>
                                                        <span>Triggers: {rule.trigger_count}</span>
                                                        {rule.metadata?.alertMode !== 'linked' && <span>{formatExpiration(rule.metadata?.expiresAt as string | null | undefined)}</span>}
                                                        {waitingState && <span className="text-text-medium sm:col-span-2">{waitingState}</span>}
                                                        {rule.last_error && <span className="text-primary-red sm:col-span-2">Latest check issue: {rule.last_error}</span>}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 self-end md:self-auto">
                                                <button type="button" onClick={() => toggleAlert(rule.id)} className="relative inline-flex cursor-pointer items-center" aria-label={rule.enabled ? 'Pause alert' : 'Activate alert'}>
                                                    <span className={`relative h-5 w-9 rounded-full border transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:transition-all after:content-[''] ${rule.enabled ? 'border-primary-green bg-primary-green after:translate-x-full after:border-white after:bg-white' : 'border-text-dark/30 bg-main after:border-gray-300 after:bg-text-medium'}`} />
                                                </button>
                                                <button type="button" onClick={() => removeAlert(rule.id)} className="rounded-lg p-2 text-text-dark transition-colors hover:bg-primary-red/10 hover:text-primary-red" aria-label="Remove alert">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </div>
                                        );
                                    })
                                ) : (
                                    <div className="flex min-h-[200px] flex-col items-center justify-center p-6 text-center">
                                        <Bell size={24} className="mb-3 text-primary-green" />
                                        <div className="text-sm font-bold text-text-light">No saved alerts yet</div>
                                        <div className="mt-1 max-w-sm text-xs text-text-medium">Create an alert to start monitoring this token.</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-text-light">
                        <Clock size={18} className="text-text-medium" />
                        Trigger History
                    </h3>
                    <div className="green-corner-card relative max-h-[680px] overflow-hidden rounded-xl border border-border bg-card">
                        <div className="custom-scrollbar max-h-[680px] space-y-1 overflow-y-auto p-5">
                            {historyItems.length ? historyItems.map((item, index) => (
                                <div key={item.id} className="flex gap-4">
                                    <div className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-[3px] border-card ${index === 0 ? 'bg-primary-green shadow-[0_0_8px_rgba(38,211,86,0.6)]' : 'bg-text-dark'}`} />
                                    <div className="flex-1 border-b border-border/30 pb-4 last:border-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <h4 className="text-sm font-bold leading-tight text-text-light">{item.title}</h4>
                                            <span className="font-mono text-[10px] text-text-dark">{formatRelativeTime(item.created_at)}</span>
                                        </div>
                                        <p className="mt-1 text-xs leading-relaxed text-text-medium">{item.message}</p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${typeStyle(item.alert_type)}`}>{item.alert_type}</span>
                                            {typeof item.metadata?.eventType === 'string' && <span className="rounded border border-primary-green/30 bg-primary-green/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-green">{item.metadata.eventType === 'partial_met' ? 'Condition met' : 'Completed'}</span>}
                                            {item.observed_value && <span className="rounded border border-border bg-main px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-text-medium">{item.observed_value}</span>}
                                        </div>
                                    </div>
                                </div>
                            )) : (
                                <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
                                    <CheckCircle2 size={24} className="mb-3 text-text-dark" />
                                    <div className="text-sm font-bold text-text-light">No alert activity yet</div>
                                    <p className="mt-1 text-xs text-text-medium">Alert activity will appear here when your saved conditions match market data.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {setupType && (
                <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" onClick={closeSetupModal}>
                    <div className={`max-h-[92vh] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${setupMode === 'linked-condition' ? 'max-w-2xl' : 'max-w-xl'}`} onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
                            <div className="flex items-start gap-3">
                                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${typeStyle(setupType.type)}`}>{setupType.icon}</div>
                                <div>
                                    <h3 className="text-lg font-bold text-text-light">{setupMode === 'linked-condition' ? 'Build Linked Alert' : `Set ${setupType.title}`}</h3>
                                    <p className="mt-1 text-sm text-text-medium">{setupType.desc}</p>
                                </div>
                            </div>
                            <button type="button" onClick={closeSetupModal} className="rounded-lg p-2 text-text-dark transition-colors hover:bg-card-hover hover:text-text-light" aria-label="Close alert setup">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="custom-scrollbar max-h-[calc(92vh-152px)] space-y-5 overflow-y-auto p-5">
                            {formError && <div className="rounded-xl border border-primary-red/30 bg-primary-red/10 px-4 py-3 text-sm text-primary-red">{formError}</div>}

                            <label className="block">
                                <span className="mb-2 block text-xs font-bold text-text-medium">Token or pair address</span>
                                <div className="atlaix-search-field px-4">
                                    <Search size={18} className="text-text-medium" />
                                    <input value={setupDraft.tokenAddress} onChange={(event) => {
                                        setSetupTokenLookupError(null);
                                        setSelectedToken(null);
                                        setSetupDraft((current) => ({ ...current, target: '', chainId: '', tokenAddress: event.target.value }));
                                    }} className="py-3 font-mono text-sm text-text-light placeholder:text-text-dark" placeholder="Paste token contract address" />
                                </div>
                                {setupTokenLookupLoading && <div className="mt-2 text-xs font-medium text-text-medium">Looking up token...</div>}
                                {setupTokenLookupError && <div className="mt-2 text-xs font-medium text-primary-red">{setupTokenLookupError}</div>}
                            </label>

                            {setupDraft.target && setupDraft.chainId && (
                                <div className="rounded-xl border border-primary-green/30 bg-primary-green/10 p-4">
                                    <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary-green">
                                        <CheckCircle2 size={14} />
                                        Token identified
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div>
                                            <div className="text-xs font-bold text-text-dark">Token name</div>
                                            <div className="mt-1 truncate text-sm font-bold text-text-light">{setupDraft.target}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-text-dark">Token network</div>
                                            <div className="mt-1 truncate text-sm font-bold text-text-light">{setupDraft.chainId}</div>
                                        </div>
                                    </div>
                                </div>
                            )}

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
                                    <div className="w-full rounded-xl border border-border bg-main px-4 py-3 text-sm font-medium text-text-light">In-app history</div>
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
                                <div className="text-xs font-bold text-text-dark">Preview</div>
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
                                                Configure an alert type, add it as a condition, then choose another alert type in this same modal.
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
                                            Add another alert type
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

                        <div className="flex flex-col-reverse gap-3 border-t border-border p-5 sm:flex-row sm:justify-end">
                            <button type="button" onClick={closeSetupModal} className="rounded-xl border border-border px-5 py-3 text-sm font-bold text-text-medium transition-colors hover:bg-card-hover hover:text-text-light">Cancel</button>
                            {setupMode === 'linked-condition' ? (
                                <>
                                    <button type="button" onClick={addLinkedCondition} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary-green/40 px-5 py-3 text-sm font-bold text-primary-green transition-colors hover:bg-primary-green/10 disabled:cursor-not-allowed disabled:opacity-60">
                                        <Plus size={16} />
                                        Add Condition
                                    </button>
                                    <button type="button" onClick={createLinkedAlert} disabled={saving || linkedConditions.length < 2} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                        {saving && <Loader2 size={16} className="animate-spin" />}
                                        Create Linked Alert
                                    </button>
                                </>
                            ) : (
                                <button type="button" onClick={createAlert} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-green px-5 py-3 text-sm font-bold text-black transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-60">
                                    {saving && <Loader2 size={16} className="animate-spin" />}
                                    Create Alert
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
