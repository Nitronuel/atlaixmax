import { apiUrl } from '../../config';

export type AiAssistantNotificationTone = 'bullish' | 'bearish' | 'neutral' | 'risk';

export type AiAssistantNotification = {
    id: string;
    title: string;
    body: string;
    tone: AiAssistantNotificationTone;
    href?: string;
    timestamp: number;
};

export type AiAssistantAction = {
    label: string;
    href: string;
    kind?: 'navigate' | 'draft' | 'confirmable' | 'handoff';
    confirmationRequired?: boolean;
    payload?: unknown;
};

export type AiAssistantProvider = {
    configured: boolean;
    model: string | null;
    mode: 'model-ready' | 'local-tool-router';
};

export type AiAssistantChatResponse = {
    id: string;
    role: 'assistant';
    answer: string;
    tool?: string;
    data?: unknown;
    actions?: AiAssistantAction[];
    provider: AiAssistantProvider;
    createdAt: string;
};

export type AiAssistantConversationMessage = {
    role: 'user' | 'assistant';
    text: string;
};

export type AiAssistantPageModule =
    | 'dashboard'
    | 'detection'
    | 'token'
    | 'wallet'
    | 'smart-money'
    | 'smart-alerts'
    | 'safe-scan'
    | 'heatmap'
    | 'narrative'
    | 'assistant'
    | 'settings'
    | 'unknown';

export type AiAssistantPageContext = {
    route: string;
    module: AiAssistantPageModule;
    title: string;
    systemContext: string;
    subjectKind?: 'token' | 'wallet' | 'detection' | 'alert' | 'scan' | 'dashboard' | 'smart-money';
    subjectAddress?: string;
    subjectChain?: string;
    pairAddress?: string;
    preferredTools?: string[];
    visibleSnapshot?: {
        generatedAt?: number;
        summary?: string;
        tokens?: Array<Record<string, unknown>>;
    };
};

const CHAT_TIMEOUT_MS = 25_000;

export function normalizeAssistantText(value: unknown) {
    return String(value || '')
        .replace(/(^|[^\w])\*\*([^*\n]+?)\*\*/g, '$1$2')
        .replace(/(^|[^\w])\*([^*\n]+?)\*/g, '$1$2')
        .replace(/^\s*\*\s+/gm, '- ')
        .replace(/\*{2,}/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
}

const fetchJson = async <T>(input: RequestInfo | URL, init?: RequestInit, timeoutMs?: number): Promise<T> => {
    const controller = timeoutMs ? new AbortController() : null;
    const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;

    let response: Response;
    try {
        response = await fetch(input, {
            ...init,
            signal: controller?.signal || init?.signal
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('That took longer than expected, so I stopped waiting. Please try again in a moment.');
        }
        throw error;
    } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Assistant request failed.');
    }

    return payload as T;
};

export const AiAssistantService = {
    getNotifications: async () => {
        return fetchJson<{
            notifications: AiAssistantNotification[];
            provider: AiAssistantProvider;
            generatedAt: string;
        }>(apiUrl('/api/ai-assistant/notifications'));
    },

    sendMessage: async (message: string, history: AiAssistantConversationMessage[] = [], pageContext?: AiAssistantPageContext | null) => {
        const response = await fetchJson<AiAssistantChatResponse>(apiUrl('/api/ai-assistant/chat'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history: history.slice(-12), pageContext })
        }, CHAT_TIMEOUT_MS);
        return {
            ...response,
            answer: normalizeAssistantText(response.answer)
        };
    }
};
