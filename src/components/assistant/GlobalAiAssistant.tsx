import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Activity,
    ArrowRight,
    Bell,
    Bot,
    ChevronDown,
    ExternalLink,
    Loader2,
    MessageSquare,
    Plus,
    Radar,
    Send,
    ShieldCheck,
    Sparkles,
    Wallet,
    X
} from 'lucide-react';
import {
    AiAssistantAction,
    AiAssistantConversationMessage,
    AiAssistantPageContext,
    AiAssistantPageModule,
    AiAssistantProvider,
    AiAssistantService,
    normalizeAssistantText
} from '../../features/ai-assistant/ai-assistant-service';
import { detectionEventSummaryForLabel } from '../../shared/detection-copy';

type FloatingMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    tool?: string;
    actions?: AiAssistantAction[];
    data?: unknown;
    createdAt: number;
};

type RouteContext = {
    title: string;
    subtitle: string;
    systemContext: string;
    subjectKind?: AiAssistantPageContext['subjectKind'];
    subjectAddress?: string;
    subjectChain?: string;
    pairAddress?: string;
    module: AiAssistantPageModule;
    preferredTools: string[];
    icon: React.ReactNode;
    prompts: string[];
};

type LiveAlphaFeedToken = {
    name?: string;
    ticker?: string;
    chain?: string;
    address?: string;
    pairAddress?: string;
    price?: string;
    change24h?: string;
    marketCap?: string;
    dexVolume?: string;
    liquidity?: string;
    dexBuys?: string;
    dexSells?: string;
    netFlow?: string;
    eventType?: string;
};

type LiveAlphaFeedSnapshot = {
    generatedAt?: number;
    total?: number;
    tokens?: LiveAlphaFeedToken[];
};

type DetectionEngineSnapshotEvent = {
    token?: {
        ticker?: string;
        name?: string;
        address?: string;
        chain?: string;
    };
    eventType?: string;
    severity?: string;
    score?: number;
    summary?: string;
    detectedAt?: number;
    metrics?: {
        volume24h?: number;
        liquidity?: number;
        marketCap?: number;
        priceChange24h?: number;
        netFlow?: number;
    };
};

type DetectionEngineSnapshot = {
    generatedAt?: number;
    total?: number;
    events?: DetectionEngineSnapshotEvent[];
};

const GLOBAL_ASSISTANT_CACHE_KEY = 'atlaix-global-ai-assistant-v2';
const GLOBAL_ASSISTANT_HANDOFF_KEY = 'atlaix-ai-assistant-handoff-v1';
const LIVE_ALPHA_FEED_SNAPSHOT_MAX_AGE_MS = 60 * 1000;
const DETECTION_ENGINE_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 1000;
const MARKET_HISTORY_MAX_AGE_MS = 2 * 60 * 1000;

const createWelcomeMessage = (title = 'Atlaix AI'): FloatingMessage => ({
    id: 'global-welcome',
    role: 'assistant',
    text: `${title} context is ready. Ask a question or use a quick action to open the right Atlaix workflow.`,
    tool: 'conversation',
    createdAt: Date.now()
});

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const toConversationHistory = (messages: FloatingMessage[]): AiAssistantConversationMessage[] =>
    messages
        .filter((message) => {
            if (message.role !== 'assistant') return true;
            const hasMarketFigures = /(?:\$[\d,.]+|\b\d+(?:\.\d+)?%|\bmarket cap\b|\bliquidity\b|\bvolume\b|\bprice\b)/i.test(message.text);
            return !hasMarketFigures || Date.now() - message.createdAt <= MARKET_HISTORY_MAX_AGE_MS;
        })
        .map((message) => ({
            role: message.role,
            text: message.text
        }));

const splitLines = (text: string) => normalizeAssistantText(text).split('\n').filter(Boolean);

const formatClock = (timestamp: number) => new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit'
}).format(new Date(timestamp));

const shortAddress = (value = '') => {
    if (value.length <= 16) return value;
    return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const parseMetricValue = (value: string | number | undefined) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const negative = raw.includes('-');
    let normalized = raw.replace(/[$,%+\s,]/g, '').toUpperCase();
    const multiplier = normalized.includes('T') ? 1e12
        : normalized.includes('B') ? 1e9
            : normalized.includes('M') ? 1e6
                : normalized.includes('K') ? 1e3
                    : 1;
    normalized = normalized.replace(/[TBMK]/g, '');
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) return 0;
    return (negative ? -parsed : parsed) * multiplier;
};

const formatCompactUsd = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '$0';
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
};

const formatSnapshotAge = (timestamp?: number) => {
    if (!timestamp) return 'just now';
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
};

const readLiveAlphaFeedSnapshot = (): LiveAlphaFeedSnapshot | null => {
    if (typeof window === 'undefined') return null;
    const inMemory = (window as any).__ATLAIX_LIVE_ALPHA_FEED__ as LiveAlphaFeedSnapshot | undefined;
    if (
        Array.isArray(inMemory?.tokens) &&
        inMemory.tokens.length &&
        inMemory.generatedAt &&
        Date.now() - inMemory.generatedAt <= LIVE_ALPHA_FEED_SNAPSHOT_MAX_AGE_MS
    ) return inMemory;

    try {
        const parsed = JSON.parse(window.localStorage.getItem('atlaix-live-alpha-feed-snapshot-v1') || 'null') as LiveAlphaFeedSnapshot | null;
        return Array.isArray(parsed?.tokens) &&
            parsed.tokens.length &&
            parsed.generatedAt &&
            Date.now() - parsed.generatedAt <= LIVE_ALPHA_FEED_SNAPSHOT_MAX_AGE_MS
            ? parsed
            : null;
    } catch {
        // Fall through to reading the rendered dashboard table.
    }

    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('table.live-alpha-table tbody tr'));
    const tokens = rows.map((row) => {
        const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td')).map((cell) => cell.innerText.trim());
        const tokenLines = (cells[0] || '').split('\n').map((line) => line.trim()).filter(Boolean);
        if (cells.length < 6 || tokenLines.length === 0) return null;

        return {
            ticker: tokenLines[0] || '',
            name: tokenLines[1] || tokenLines[0] || '',
            eventType: cells[1] || '',
            price: cells[2] || '',
            change24h: cells[3] || '',
            marketCap: cells[4] || '',
            dexVolume: cells[5] || '',
            liquidity: cells[6] || '',
            dexBuys: cells[7] || '',
            dexSells: cells[8] || '',
            netFlow: cells[9] || ''
        } satisfies LiveAlphaFeedToken;
    }).filter((token) => Boolean(token?.ticker)) as LiveAlphaFeedToken[];

    return tokens.length ? {
        generatedAt: Date.now(),
        total: tokens.length,
        tokens
    } : null;
};

const normalizeDetectionSnapshotEvent = (event: any): DetectionEngineSnapshotEvent | null => {
    if (!event || typeof event !== 'object') return null;
    const token = event.token || {};
    const ticker = String(token.ticker || token.symbol || '').trim();
    const name = String(token.name || ticker || '').trim();
    if (!ticker && !name && !token.address) return null;

    return {
        token: {
            ticker,
            name,
            address: String(token.address || '').trim(),
            chain: String(token.chain || '').trim()
        },
        eventType: String(event.eventType || event.type || '').trim(),
        severity: String(event.severity || 'Medium'),
        score: Number.isFinite(Number(event.score)) ? Number(event.score) : undefined,
        summary: detectionEventSummaryForLabel(String(event.eventType || event.type || ''), String(event.summary || '')).slice(0, 220),
        detectedAt: Number.isFinite(Number(event.detectedAt)) ? Number(event.detectedAt) : undefined,
        metrics: {
            volume24h: Number(event.metrics?.volume24h || 0),
            liquidity: Number(event.metrics?.liquidity || 0),
            marketCap: Number(event.metrics?.marketCap || 0),
            priceChange24h: Number(event.metrics?.priceChange24h || 0),
            netFlow: Number(event.metrics?.netFlow || 0)
        }
    };
};

const readDetectionEngineSnapshot = (): DetectionEngineSnapshot | null => {
    if (typeof window === 'undefined') return null;

    try {
        const parsed = JSON.parse(window.localStorage.getItem('atlaix-detection-events-cache') || 'null') as { data?: unknown[]; timestamp?: number } | null;
        const events = Array.isArray(parsed?.data)
            ? parsed.data.map(normalizeDetectionSnapshotEvent).filter(Boolean) as DetectionEngineSnapshotEvent[]
            : [];
        if (events.length && parsed?.timestamp && Date.now() - parsed.timestamp <= DETECTION_ENGINE_SNAPSHOT_MAX_AGE_MS) {
            return {
                generatedAt: parsed.timestamp,
                total: events.length,
                events: events.slice(0, 10)
            };
        }
    } catch {
        // Fall through to reading rendered cards.
    }

    const cards = Array.from(document.querySelectorAll<HTMLElement>('.detection-event-card')).slice(0, 10);
    const events = cards.map((card) => {
        const text = card.innerText.replace(/\s+/g, ' ').trim();
        if (!text) return null;
        return {
            eventType: text.slice(0, 80),
            summary: text.slice(0, 220)
        } satisfies DetectionEngineSnapshotEvent;
    }).filter(Boolean) as DetectionEngineSnapshotEvent[];

    return events.length ? {
        generatedAt: Date.now(),
        total: events.length,
        events
    } : null;
};

const isLiveAlphaFeedQuestion = (text: string, context: RouteContext) => {
    const lower = text.toLowerCase();
    return context.title === 'Dashboard' && (
        /\blive\s+alpha\b/.test(lower) ||
        /\balpha\s+feed\b/.test(lower) ||
        /\bfeed\s+section\b/.test(lower) ||
        /\bthis\s+feed\b/.test(lower) ||
        /\bfeed\b/.test(lower) && /\b(market\s*cap|mcap|liquidity|volume|inflow|outflow|gainer|loser|highest|largest|biggest|top)\b/.test(lower)
    );
};

const buildLiveAlphaFeedAnswer = (text: string, context: RouteContext): FloatingMessage | null => {
    if (!isLiveAlphaFeedQuestion(text, context)) return null;

    const snapshot = readLiveAlphaFeedSnapshot();
    const tokens = snapshot?.tokens || [];
    if (!tokens.length) {
        return {
            id: `global-feed-answer-${Date.now()}`,
            role: 'assistant',
            text: 'I do not have a fresh Live Alpha Feed snapshot right now. Refresh the dashboard once, then ask me again and I will read from the current feed directly.',
            tool: 'dashboard_feed',
            createdAt: Date.now()
        };
    }

    const lower = text.toLowerCase();
    const metric = /\bliquidity\b/.test(lower) ? 'liquidity'
        : /\bvolume\b|\bdex volume\b/.test(lower) ? 'dexVolume'
            : /\binflow\b|\bflow\b/.test(lower) ? 'netFlow'
                : /\bgainer|gain|change|up\b/.test(lower) ? 'change24h'
                    : /\bloser|down\b/.test(lower) ? 'change24h'
                        : 'marketCap';
    const wantsLowest = /\blowest|smallest|least|loser|down\b/.test(lower);

    const ranked = [...tokens]
        .map((token) => ({
            token,
            value: parseMetricValue(token[metric as keyof LiveAlphaFeedToken] as string | undefined)
        }))
        .filter((item) => Number.isFinite(item.value) && item.value !== 0)
        .sort((a, b) => wantsLowest ? a.value - b.value : b.value - a.value);

    const top = ranked[0];
    if (!top) {
        return {
            id: `global-feed-answer-${Date.now()}`,
            role: 'assistant',
            text: 'I can see the Live Alpha Feed snapshot, but the metric you asked for is not populated on the current rows yet.',
            tool: 'dashboard_feed',
            createdAt: Date.now()
        };
    }

    const label = metric === 'marketCap' ? 'market cap'
        : metric === 'dexVolume' ? 'DEX volume'
            : metric === 'netFlow' ? 'net flow'
                : metric === 'liquidity' ? 'liquidity'
                    : '24h change';
    const value = metric === 'change24h'
        ? `${top.value.toFixed(2)}%`
        : formatCompactUsd(top.value);
    const addressLine = top.token.address ? `Address: ${top.token.address}.` : '';
    const topThree = ranked.slice(0, 3)
        .map((item, index) => {
            const rowValue = metric === 'change24h' ? `${item.value.toFixed(2)}%` : formatCompactUsd(item.value);
            return `${index + 1}. ${item.token.ticker || item.token.name} (${item.token.name || 'Unknown'}) on ${item.token.chain || 'unknown'}: ${rowValue}`;
        })
        .join('\n');

    return {
        id: `global-feed-answer-${Date.now()}`,
        role: 'assistant',
        text: [
            `From the current Live Alpha Feed, ${top.token.ticker || top.token.name} has the ${wantsLowest ? 'lowest' : 'highest'} ${label}: ${value}.`,
            `${top.token.name ? `Token: ${top.token.name}.` : ''} ${top.token.chain ? `Chain: ${top.token.chain}.` : ''} Price: ${top.token.price || 'unavailable'}. 24h change: ${top.token.change24h || 'unavailable'}. ${addressLine}`.trim(),
            '',
            `Top ${Math.min(3, ranked.length)} by ${label}:`,
            topThree,
            '',
            `Snapshot: ${tokens.length} feed rows available, updated ${formatSnapshotAge(snapshot?.generatedAt)}.`
        ].filter(Boolean).join('\n'),
        tool: 'dashboard_feed',
        actions: top.token.address ? [{
            label: 'Open Token Details',
            href: `/token/${encodeURIComponent(top.token.address)}${top.token.pairAddress || top.token.chain ? `?${new URLSearchParams({
                ...(top.token.pairAddress ? { pair: top.token.pairAddress } : {}),
                ...(top.token.chain ? { chain: top.token.chain } : {})
            }).toString()}` : ''}`,
            kind: 'navigate'
        }] : [],
        createdAt: Date.now()
    };
};

const toolLabel = (tool?: string) => {
    if (tool === 'get_token_deep_brief') return 'Token Brief';
    if (tool === 'get_wallet_deep_brief') return 'Wallet Brief';
    if (tool === 'get_platform_updates') return 'Platform Update';
    if (tool?.startsWith('get_detection_') || tool === 'explain_detection_event_type' || tool === 'compare_detection_events') return 'Detection';
    if (tool === 'dashboard_feed') return 'Live Alpha Feed';
    if (tool === 'run_safe_scan' || tool?.startsWith('get_safe_scan_') || tool === 'explain_safe_scan_metric') return 'Safe Scan';
    if (tool === 'get_token_activity') return 'Activity';
    if (tool === 'get_smart_alert_status' || tool === 'alert_setup' || tool === 'alert_setup_needs_token') return 'Smart Alerts';
    if (tool === 'error') return 'Needs Attention';
    return 'Atlaix AI';
};

const toolIcon = (tool?: string) => {
    if (tool === 'get_token_deep_brief') return <Activity size={14} />;
    if (tool === 'get_wallet_deep_brief') return <Wallet size={14} />;
    if (tool === 'run_safe_scan' || tool?.startsWith('get_safe_scan_') || tool === 'explain_safe_scan_metric') return <ShieldCheck size={14} />;
    if (tool?.startsWith('get_detection_') || tool === 'explain_detection_event_type' || tool === 'compare_detection_events') return <Radar size={14} />;
    if (tool === 'get_smart_alert_status' || tool === 'alert_setup' || tool === 'alert_setup_needs_token') return <Bell size={14} />;
    if (tool === 'get_platform_updates') return <Radar size={14} />;
    if (tool === 'dashboard_feed') return <Activity size={14} />;
    return <Bot size={14} />;
};

const getPathPart = (pathname: string, index: number) => {
    const part = pathname.split('/').filter(Boolean)[index] || '';
    try {
        return decodeURIComponent(part);
    } catch {
        return part;
    }
};

const getRouteContext = (pathname: string, searchParams: URLSearchParams): RouteContext => {
    const routeRoot = getPathPart(pathname, 0);
    const routeSubject = getPathPart(pathname, 1);
    const address = routeSubject || '';
    const chain = searchParams.get('chain') || '';
    const pair = searchParams.get('pair') || '';

    if (routeRoot === 'token' && address) {
        return {
            title: 'Token Page',
            subtitle: `${shortAddress(address)}${chain ? ` on ${chain}` : ''}`,
            systemContext: `The user is viewing a token details page. Token address: ${address}. Chain: ${chain || 'unknown'}. Pair: ${pair || 'unknown'}. Use this token context when the user says this token, it, or here.`,
            subjectKind: 'token',
            subjectAddress: address,
            subjectChain: chain,
            pairAddress: pair,
            module: 'token',
            preferredTools: ['get_token_deep_brief', 'get_token_overview', 'get_token_holders', 'get_token_top_holder', 'get_token_holder_concentration', 'get_token_holder_bundle', 'get_detection_filtered', 'run_safe_scan', 'prepare_alert_setup'],
            icon: <Activity size={18} />,
            prompts: [
                'Explain this token in plain English',
                'Help me create a Smart Alert for this token',
                'Run a Safe Scan on this token',
                'What changed recently for this token?'
            ]
        };
    }

    if (routeRoot === 'wallet') {
        return {
            title: 'Wallets',
            subtitle: address ? shortAddress(address) : 'Wallet intelligence',
            systemContext: address
                ? `The user is viewing wallet intelligence for wallet address: ${address}.`
                : 'The user is on the Wallet Tracker page.',
            subjectKind: address ? 'wallet' : undefined,
            subjectAddress: address,
            subjectChain: chain,
            module: 'wallet',
            preferredTools: ['get_wallet_deep_brief', 'get_token_activity', 'get_smart_alert_status'],
            icon: <Wallet size={18} />,
            prompts: [
                address ? 'Analyze this wallet' : 'Help me inspect a wallet',
                'What should I watch in wallet activity?',
                'Explain smart-money behavior',
                'Show me useful wallet workflows'
            ]
        };
    }

    if (routeRoot === 'detection') {
        const query = getPathPart(pathname, 1) === 'token' ? getPathPart(pathname, 2) : '';
        return {
            title: 'Detection',
            subtitle: query ? shortAddress(query) : 'Market events',
            systemContext: query
                ? `The user is viewing Detection Engine context for token/query: ${query}. Explain admission reasons, event type, severity, score, triggers, risk/counter-signals, and next watch conditions for this token. If they ask "this event" or "why was it detected", use this token/query.`
                : [
                    'The user is on the Detection Engine page.',
                    'They may ask what was detected, which events are high-risk, why a token qualified, what an event type means, which tokens are accumulating/distributing/moving, whether a signal is bullish or risky, what to watch next, or what Smart Alert to create.',
                    'Detection Engine events are attention signals, not buy/sell commands. Explain them with event type, severity, score, market/liquidity/volume context, counter-signals, uncertainty, and next checks.'
                ].join(' '),
            subjectKind: query ? 'detection' : undefined,
            subjectAddress: query,
            subjectChain: chain,
            module: 'detection',
            preferredTools: ['get_detection_filtered', 'explain_detection_admission', 'get_detection_updates', 'get_token_deep_brief', 'get_token_activity', 'run_safe_scan', 'prepare_detection_alert'],
            icon: <Radar size={18} />,
            prompts: [
                query ? 'Why was this token detected?' : 'What events were detected?',
                query ? 'Explain this event in plain English' : 'Show high severity detections',
                query ? 'Is this signal bullish or risky?' : 'Which tokens are accumulating?',
                query ? 'What should I watch next?' : 'What should I pay attention to today?'
            ]
        };
    }

    if (pathname.startsWith('/smart-alerts')) {
        return {
            title: 'Smart Alerts',
            subtitle: 'Alert setup',
            systemContext: 'The user is on the Smart Alerts page. Help them create or understand alert setup, but never claim an alert was saved silently.',
            subjectKind: 'alert',
            module: 'smart-alerts',
            preferredTools: ['prepare_alert_setup', 'prepare_detection_alert', 'prepare_linked_alert', 'get_smart_alert_status'],
            icon: <Bell size={18} />,
            prompts: [
                'Help me create a price alert',
                'What alerts should I use?',
                'Explain detection-based alerts',
                'Check Smart Alert status'
            ]
        };
    }

    if (pathname.startsWith('/safe-scan')) {
        const scanAddress = searchParams.get('address') || '';
        const scanChain = searchParams.get('chain') || searchParams.get('network') || '';
        return {
            title: 'Safe Scan',
            subtitle: scanAddress ? `${shortAddress(scanAddress)}${scanChain ? ` on ${scanChain}` : ''}` : 'Risk workflow',
            systemContext: scanAddress
                ? `The user is on the Safe Scan page for token address: ${scanAddress}. Chain: ${scanChain || 'unknown'}. Use Safe Scan tools for questions about this scan, Bubblemaps score, holders, supply exposure, clusters, linked wallets, Gini, HHI, and Nakamoto.`
                : 'The user is on the Safe Scan page. Help them reason about token safety, Bubblemaps score, holder concentration, clusters, and scanner workflows.',
            subjectKind: 'scan',
            subjectAddress: scanAddress,
            subjectChain: scanChain,
            module: 'safe-scan',
            preferredTools: ['get_safe_scan_brief', 'get_safe_scan_holders', 'get_safe_scan_clusters', 'explain_safe_scan_metric'],
            icon: <ShieldCheck size={18} />,
            prompts: [
                scanAddress ? 'Explain this Safe Scan' : 'Help me run a Safe Scan',
                'What holder risks should I check?',
                'Explain the Bubblemaps score',
                'Are the top holders connected?'
            ]
        };
    }

    if (pathname.startsWith('/smart-money') || pathname.startsWith('/token-smart-money')) {
        return {
            title: 'Smart Money',
            subtitle: address ? shortAddress(address) : 'Wallet and capital intelligence',
            systemContext: address
                ? `The user is viewing smart-money context for address or token: ${address}.`
                : 'The user is on the Smart Money page.',
            subjectKind: address ? 'smart-money' : undefined,
            subjectAddress: address,
            module: 'smart-money',
            preferredTools: ['get_wallet_deep_brief', 'get_token_activity', 'get_platform_updates', 'open_token_details'],
            icon: <Wallet size={18} />,
            prompts: [
                'What are smart wallets doing?',
                'Show top smart-money flows',
                'Explain this wallet behavior',
                'What should I watch next?'
            ]
        };
    }

    if (pathname.startsWith('/heatmap')) {
        return {
            title: 'Token Heatmap',
            subtitle: 'Market map',
            systemContext: 'The user is on the Token Heatmap page, which may not have live heatmap data available yet.',
            module: 'heatmap',
            preferredTools: ['get_platform_updates', 'get_detection_updates'],
            icon: <Activity size={18} />,
            prompts: [
                'What should I use instead?',
                'Show active tokens',
                'What is moving today?',
                'Open Detection context'
            ]
        };
    }

    if (pathname.startsWith('/sentiment')) {
        return {
            title: 'Narrative Intelligence',
            subtitle: 'Narrative context',
            systemContext: 'The user is on the Narrative Intelligence page. Treat narrative/social views cautiously unless live data is available.',
            module: 'narrative',
            preferredTools: ['get_detection_updates', 'get_platform_updates', 'get_token_deep_brief'],
            icon: <Sparkles size={18} />,
            prompts: [
                'What narratives are active?',
                'Show tokens with unusual activity',
                'What should I verify?',
                'Open Detection context'
            ]
        };
    }

    return {
        title: 'Dashboard',
        subtitle: 'Atlaix overview',
        systemContext: 'The user is on the Atlaix dashboard overview.',
        subjectKind: 'dashboard',
        module: 'dashboard',
        preferredTools: ['get_platform_updates', 'get_detection_updates', 'get_token_overview', 'prepare_alert_setup'],
        icon: <Sparkles size={18} />,
        prompts: [
            'What should I pay attention to today?',
            'Show tokens with accumulation events',
            'What tokens are performing well?',
            'Help me set an alert'
        ]
    };
};

const promptToMessage = (prompt: string, context: RouteContext) => {
    if (prompt === 'Help me create a Smart Alert for this token') return 'Help me create a Smart Alert for this token';
    if (prompt === 'Run a Safe Scan on this token') return 'Run a Safe Scan on this token';
    if (prompt === 'Explain this token in plain English') return 'Explain this token in plain English';
    if (prompt === 'Analyze this wallet') return 'Analyze this wallet';
    return prompt || `Help me with ${context.title}`;
};

const hasContextReference = (text: string) =>
    /\b(this|that|it|here|current|these)\s*(token|coin|wallet|address|page|scan|alert|signal|event)?\b/i.test(text);

const buildAssistantRequestText = (text: string, context: RouteContext) => {
    const trimmed = text.trim();
    if (!trimmed) return trimmed;

    if (context.subjectKind === 'token' && context.subjectAddress && hasContextReference(trimmed)) {
        return [
            trimmed,
            `Token address: ${context.subjectAddress}.`,
            context.subjectChain ? `Chain: ${context.subjectChain}.` : ''
        ].filter(Boolean).join(' ');
    }

    if (context.subjectKind === 'wallet' && context.subjectAddress && hasContextReference(trimmed)) {
        return `${trimmed} Wallet address: ${context.subjectAddress}.`;
    }

    if (context.subjectKind === 'detection' && context.subjectAddress && hasContextReference(trimmed)) {
        return `${trimmed} Token or detection query: ${context.subjectAddress}.`;
    }

    if (context.subjectKind === 'scan' && context.subjectAddress && hasContextReference(trimmed)) {
        return [
            trimmed,
            `Safe Scan token address: ${context.subjectAddress}.`,
            context.subjectChain ? `Chain: ${context.subjectChain}.` : ''
        ].filter(Boolean).join(' ');
    }

    return trimmed;
};

const buildPageContextPayload = (context: RouteContext, pathname: string): AiAssistantPageContext => {
    const liveAlphaSnapshot = context.module === 'dashboard' ? readLiveAlphaFeedSnapshot() : null;
    const detectionSnapshot = context.module === 'detection' ? readDetectionEngineSnapshot() : null;
    const visibleSnapshot = detectionSnapshot ? {
        generatedAt: detectionSnapshot.generatedAt,
        summary: `${detectionSnapshot.events?.length || 0} recent Detection Engine events visible or cached. Event questions should use Detection tools and explain event type, severity, score, liquidity, volume, net flow, and uncertainty.`,
        tokens: (detectionSnapshot.events || []).slice(0, 10).map((event) => ({
            name: event.token?.name,
            ticker: event.token?.ticker,
            chain: event.token?.chain,
            address: event.token?.address,
            eventType: event.eventType,
            severity: event.severity,
            score: event.score,
            summary: event.summary,
            volume24h: event.metrics?.volume24h,
            liquidity: event.metrics?.liquidity,
            marketCap: event.metrics?.marketCap,
            priceChange24h: event.metrics?.priceChange24h,
            netFlow: event.metrics?.netFlow,
            detectedAt: event.detectedAt
        }))
    } : liveAlphaSnapshot ? {
        generatedAt: liveAlphaSnapshot.generatedAt,
        summary: `${liveAlphaSnapshot.tokens?.length || 0} current Live Alpha Feed rows available.`,
        tokens: (liveAlphaSnapshot.tokens || []).slice(0, 10).map((token) => ({
            name: token.name,
            ticker: token.ticker,
            chain: token.chain,
            address: token.address,
            price: token.price,
            change24h: token.change24h,
            marketCap: token.marketCap,
            dexVolume: token.dexVolume,
            liquidity: token.liquidity,
            eventType: token.eventType
        }))
    } : undefined;

    return {
        route: pathname,
        module: context.module,
        title: context.title,
        systemContext: context.systemContext,
        subjectKind: context.subjectKind,
        subjectAddress: context.subjectAddress,
        subjectChain: context.subjectChain,
        pairAddress: context.pairAddress,
        preferredTools: context.preferredTools,
        visibleSnapshot
    };
};

export const GlobalAiAssistant: React.FC = () => {
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const routeContext = useMemo(
        () => getRouteContext(location.pathname, searchParams),
        [location.pathname, searchParams]
    );
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<FloatingMessage[]>(
        [createWelcomeMessage(routeContext.title)]
    );
    const [draft, setDraft] = useState('');
    const [provider, setProvider] = useState<AiAssistantProvider | null>(null);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const routeKeyRef = useRef(`${location.pathname}${location.search}`);

    useEffect(() => {
        const routeKey = `${location.pathname}${location.search}`;
        if (routeKeyRef.current === routeKey) return;

        routeKeyRef.current = routeKey;
        setOpen(false);
        setDraft('');
        setProvider(null);
        setSending(false);
        setMessages([createWelcomeMessage(routeContext.title)]);

        if (canUseLocalStorage()) {
            window.localStorage.removeItem(GLOBAL_ASSISTANT_CACHE_KEY);
        }
    }, [location.pathname, location.search, routeContext.title]);

    useEffect(() => {
        if (open) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [messages, open, sending]);

    const goToAction = (href: string) => {
        if (href.startsWith('/ai-assistant')) {
            try {
                window.sessionStorage.setItem(GLOBAL_ASSISTANT_HANDOFF_KEY, JSON.stringify({
                    messages,
                    draft,
                    provider,
                    pageContext: buildPageContextPayload(routeContext, location.pathname),
                    savedAt: Date.now()
                }));
            } catch {
                // Handoff is a convenience; navigation should still work if storage fails.
            }
        }

        if (href.startsWith('/')) {
            navigate(href);
            setOpen(false);
            return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
    };

    const sendMessage = async (text = draft) => {
        const trimmed = text.trim();
        if (!trimmed || sending) return;

        const userMessage: FloatingMessage = {
            id: `global-user-${Date.now()}`,
            role: 'user',
            text: trimmed,
            createdAt: Date.now()
        };
        const history = toConversationHistory(messages);
        const assistantMessage = buildAssistantRequestText(trimmed, routeContext);
        const pageContext = buildPageContextPayload(routeContext, location.pathname);

        setDraft('');
        setSending(true);
        setOpen(true);
        setMessages((current) => [...current, userMessage]);

        const feedAnswer = buildLiveAlphaFeedAnswer(trimmed, routeContext);
        if (feedAnswer) {
            setMessages((current) => [...current, {
                ...feedAnswer,
                actions: [
                    ...(feedAnswer.actions || []),
                    { label: 'Continue in AI Assistant', href: '/ai-assistant?handoff=1', kind: 'handoff' }
                ]
            }]);
            setSending(false);
            return;
        }

        try {
            const response = await AiAssistantService.sendMessage(assistantMessage, history, pageContext);
            setProvider(response.provider);
            setMessages((current) => [
                ...current,
                {
                    id: response.id,
                    role: 'assistant',
                    text: normalizeAssistantText(response.answer),
                    tool: response.tool,
                    data: response.data,
                    actions: [
                        ...(response.actions || []),
                        { label: 'Continue in AI Assistant', href: '/ai-assistant?handoff=1', kind: 'handoff' }
                    ],
                    createdAt: new Date(response.createdAt).getTime() || Date.now()
                }
            ]);
        } catch (error) {
            setMessages((current) => [
                ...current,
                {
                    id: `global-assistant-error-${Date.now()}`,
                    role: 'assistant',
                    text: error instanceof Error ? normalizeAssistantText(error.message) : 'I could not complete that request.',
                    tool: 'error',
                    createdAt: Date.now()
                }
            ]);
        } finally {
            setSending(false);
        }
    };

    const startNewChat = () => {
        setMessages([createWelcomeMessage(routeContext.title)]);
        setDraft('');
        setProvider(null);
        setOpen(true);
    };

    if (location.pathname.startsWith('/ai-assistant')) {
        return null;
    }

    return (
        <div className="global-ai-assistant fixed bottom-5 right-5 z-[70] sm:bottom-6 sm:right-6">
            {open && (
                <div className="mb-4 flex h-[min(680px,calc(100dvh-150px))] w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[26px] border border-white/76 bg-white/88 shadow-[18px_24px_70px_rgba(73,119,88,0.24)] backdrop-blur-2xl animate-fade-in">
                    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-white shadow-[0_14px_34px_rgba(63,163,77,0.22)] ring-1 ring-border">
                                <img
                                    src="/logo.png"
                                    alt="Atlaix"
                                    className="h-8 w-8 object-contain"
                                    onError={(event) => { event.currentTarget.style.display = 'none'; }}
                                />
                            </div>
                            <div className="min-w-0">
                                <div className="truncate text-sm font-black text-text-light">Atlaix AI</div>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <button
                                type="button"
                                onClick={startNewChat}
                                className="grid h-9 w-9 place-items-center rounded-full text-text-medium transition-colors hover:bg-main hover:text-primary-green"
                                aria-label="Start new assistant chat"
                                title="New chat"
                            >
                                <Plus size={17} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="grid h-9 w-9 place-items-center rounded-full text-text-medium transition-colors hover:bg-main hover:text-text-light"
                                aria-label="Close assistant"
                                title="Close"
                            >
                                <X size={17} />
                            </button>
                        </div>
                    </header>

                    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        <div className="mb-4 grid grid-cols-2 gap-2">
                            {routeContext.prompts.map((prompt) => (
                                <button
                                    key={prompt}
                                    type="button"
                                    onClick={() => sendMessage(promptToMessage(prompt, routeContext))}
                                    disabled={sending}
                                    className="min-h-[46px] rounded-2xl border border-border bg-main/72 px-3 py-2 text-left text-xs font-bold leading-snug text-text-medium transition-colors hover:border-primary-green/45 hover:bg-primary-green/10 hover:text-text-light disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>

                        <div className="space-y-3">
                            {messages.map((message) => {
                                const isUser = message.role === 'user';
                                return (
                                    <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`min-w-0 max-w-[88%] overflow-hidden rounded-2xl px-4 py-3 shadow-sm ${
                                            isUser
                                                ? 'rounded-br-md bg-primary-green text-white'
                                                : 'rounded-bl-md border border-border bg-card text-text-light'
                                        }`}>
                                            {!isUser && (
                                                <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-primary-green">
                                                    {toolIcon(message.tool)}
                                                    {toolLabel(message.tool)}
                                                </div>
                                            )}
                                            <div className={`min-w-0 space-y-2 text-sm leading-relaxed break-words [overflow-wrap:anywhere] ${isUser ? 'font-semibold' : 'font-medium'}`}>
                                                {splitLines(message.text).map((line, index) => (
                                                    <p key={index} className="min-w-0 break-words [overflow-wrap:anywhere]">{line}</p>
                                                ))}
                                            </div>
                                            {message.actions && message.actions.length > 0 && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    {message.actions.map((action) => (
                                                        <button
                                                            key={`${message.id}-${action.label}-${action.href}`}
                                                            type="button"
                                                            onClick={() => goToAction(action.href)}
                                                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary-green/30 bg-primary-green/10 px-3 py-1.5 text-xs font-black text-primary-green transition-colors hover:border-primary-green"
                                                        >
                                                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{action.label}</span>
                                                            {action.href.startsWith('/') ? <ArrowRight size={13} /> : <ExternalLink size={13} />}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            <div className={`mt-2 text-right text-[10px] ${isUser ? 'text-white/70' : 'text-text-dark'}`}>
                                                {formatClock(message.createdAt)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {sending && (
                                <div className="flex justify-start">
                                    <div className="rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 text-sm font-bold text-text-medium shadow-sm">
                                        <Loader2 size={15} className="mr-2 inline animate-spin" />
                                        Thinking
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    </div>

                    <form
                        onSubmit={(event) => {
                            event.preventDefault();
                            sendMessage();
                        }}
                        className="shrink-0 border-t border-border bg-card p-3"
                    >
                        <div className="flex items-end gap-2 rounded-2xl border border-border bg-main/76 p-2 focus-within:border-primary-green/60">
                            <textarea
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        sendMessage();
                                    }
                                }}
                                placeholder="Ask Atlaix AI"
                                className="max-h-28 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2 text-sm font-medium text-text-light outline-none placeholder:text-text-dark"
                            />
                            <button
                                type="submit"
                                disabled={!draft.trim() || sending}
                                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-green text-white transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-45"
                                aria-label="Send assistant message"
                            >
                                <Send size={17} />
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                className="group flex h-14 items-center gap-3 rounded-full border border-white/80 bg-primary-green px-4 text-white shadow-[0_18px_44px_rgba(63,163,77,0.34)] transition-transform hover:scale-[1.03] focus:outline-none focus:ring-4 focus:ring-primary-green/20"
                aria-label={open ? 'Collapse Atlaix AI assistant' : 'Open Atlaix AI assistant'}
            >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-white/18">
                    {open ? <ChevronDown size={19} /> : <MessageSquare size={19} />}
                </span>
                <span className="hidden text-sm font-black sm:block">Ask Atlaix AI</span>
            </button>
        </div>
    );
};
