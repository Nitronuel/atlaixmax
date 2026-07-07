import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    Activity,
    ArrowRight,
    Bell,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Plus,
    Radar,
    Send,
    ShieldCheck,
    User
} from 'lucide-react';
import {
    AiAssistantAction,
    AiAssistantConversationMessage,
    AiAssistantPageContext,
    AiAssistantProvider,
    AiAssistantService,
    normalizeAssistantText
} from './ai-assistant-service';

type ChatMessage = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    tool?: string;
    data?: unknown;
    actions?: AiAssistantAction[];
    createdAt: number;
};

const SUGGESTED_PROMPTS = [
    'What tokens are performing well?',
    'Tokens with accumulation events',
    'Run a risk read on a token'
];

const ASSISTANT_CHAT_CACHE_KEY = 'atlaix-ai-assistant-chat-v1';
const ASSISTANT_HANDOFF_KEY = 'atlaix-ai-assistant-handoff-v1';
const ASSISTANT_CHAT_TTL_MS = 60 * 60 * 1000;
const MARKET_HISTORY_MAX_AGE_MS = 2 * 60 * 1000;

type AssistantChatCache = {
    messages: ChatMessage[];
    draft: string;
    provider: AiAssistantProvider | null;
    savedAt: number;
};

type AssistantHandoff = {
    messages?: ChatMessage[];
    draft?: string;
    provider?: AiAssistantProvider | null;
    pageContext?: AiAssistantPageContext | null;
    savedAt?: number;
};

const createWelcomeMessage = (): ChatMessage => ({
    id: 'welcome',
    role: 'assistant',
    text: 'Ask about a token, wallet, alert, risk signal, or market move. I can open the right Atlaix workflow when there is enough context.',
    tool: 'conversation',
    createdAt: Date.now()
});

const canUseLocalStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const loadAssistantChatCache = (): AssistantChatCache | null => {
    if (!canUseLocalStorage()) return null;

    try {
        const raw = window.localStorage.getItem(ASSISTANT_CHAT_CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as AssistantChatCache;
        if (!Array.isArray(parsed.messages) || typeof parsed.savedAt !== 'number') return null;
        if (Date.now() - parsed.savedAt > ASSISTANT_CHAT_TTL_MS) {
            window.localStorage.removeItem(ASSISTANT_CHAT_CACHE_KEY);
            return null;
        }

        return {
            messages: parsed.messages.filter((message) => message?.id && message?.role && message?.text).slice(-40).map((message) => ({
                ...message,
                text: message.role === 'assistant' ? normalizeAssistantText(message.text) : message.text
            })),
            draft: typeof parsed.draft === 'string' ? parsed.draft : '',
            provider: parsed.provider || null,
            savedAt: parsed.savedAt
        };
    } catch {
        return null;
    }
};

const loadAssistantHandoff = (): AssistantHandoff | null => {
    if (!canUseLocalStorage()) return null;

    try {
        const raw = window.sessionStorage.getItem(ASSISTANT_HANDOFF_KEY);
        if (!raw) return null;
        window.sessionStorage.removeItem(ASSISTANT_HANDOFF_KEY);

        const parsed = JSON.parse(raw) as AssistantHandoff;
        if (!parsed.savedAt || Date.now() - parsed.savedAt > ASSISTANT_CHAT_TTL_MS) return null;

        return {
            messages: Array.isArray(parsed.messages) ? parsed.messages.filter((message) => message?.id && message?.role && message?.text).slice(-40).map((message) => ({
                ...message,
                text: message.role === 'assistant' ? normalizeAssistantText(message.text) : message.text
            })) : [],
            draft: typeof parsed.draft === 'string' ? parsed.draft : '',
            provider: parsed.provider || null,
            pageContext: parsed.pageContext || null,
            savedAt: parsed.savedAt
        };
    } catch {
        return null;
    }
};

const saveAssistantChatCache = (cache: Omit<AssistantChatCache, 'savedAt'>) => {
    if (!canUseLocalStorage()) return;

    try {
        window.localStorage.setItem(ASSISTANT_CHAT_CACHE_KEY, JSON.stringify({
            ...cache,
            messages: cache.messages.slice(-40),
            savedAt: Date.now()
        }));
    } catch {
        // Chat persistence is a convenience; do not interrupt the assistant if storage is unavailable.
    }
};

const splitLines = (text: string) => normalizeAssistantText(text).split('\n').filter(Boolean);

type AssistantInlineReference = {
    label: string;
    href: string;
    title: string;
};

const getAssistantDataReferences = (data: unknown): AssistantInlineReference[] => {
    const payload = data as {
        events?: Array<{ token?: string; href?: string; eventType?: string }>;
        tokens?: Array<{ token?: string; name?: string; href?: string }>;
        candidates?: Array<{ token?: string; name?: string; href?: string }>;
        token?: { token?: string; ticker?: string; name?: string; href?: string };
    } | null;
    if (!payload) return [];

    const items = [
        ...(Array.isArray(payload.events) ? payload.events.map((event) => ({
            label: event?.token,
            href: event?.href,
            title: event?.eventType ? `Open ${event.token} ${event.eventType} context` : `Open ${event.token} in Atlaix`
        })) : []),
        ...(Array.isArray(payload.tokens) ? payload.tokens.map((token) => ({
            label: token?.token || token?.name,
            href: token?.href,
            title: `Open ${token?.token || token?.name} in Atlaix`
        })) : []),
        ...(Array.isArray(payload.candidates) ? payload.candidates.map((token) => ({
            label: token?.token || token?.name,
            href: token?.href,
            title: `Open ${token?.token || token?.name} in Atlaix`
        })) : []),
        payload.token ? {
            label: payload.token.token || payload.token.ticker || payload.token.name,
            href: payload.token.href,
            title: `Open ${payload.token.token || payload.token.ticker || payload.token.name} in Atlaix`
        } : null
    ];

    return items
        .map((item) => {
            const label = String(item?.label || '').trim();
            const href = String(item?.href || '').trim();
            if (!label || !href) return null;

            return {
                label,
                href,
                title: item?.title || `Open ${label} in Atlaix`
            };
        })
        .filter((reference): reference is AssistantInlineReference => Boolean(reference));
};

const normalizeReferenceLabel = (value: string) =>
    value.trim().toLowerCase().replace(/^\d+\.\s*/, '').replace(/[:(].*$/, '').trim();

const findInlineReference = (line: string, references: AssistantInlineReference[]) => {
    const normalizedLineStart = normalizeReferenceLabel(line);
    if (!normalizedLineStart) return null;

    return references.find((reference) => {
        const label = normalizeReferenceLabel(reference.label);
        return normalizedLineStart === label || normalizedLineStart.startsWith(`${label} `);
    }) || null;
};

const toConversationHistory = (messages: ChatMessage[]): AiAssistantConversationMessage[] =>
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

const formatClock = (timestamp: number) => new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit'
}).format(new Date(timestamp));

const toolLabel = (tool?: string) => {
    if (tool === 'get_token_deep_brief') return 'Token Brief';
    if (tool === 'get_wallet_deep_brief') return 'Wallet Brief';
    if (tool === 'get_platform_updates') return 'Platform Update';
    if (tool === 'run_safe_scan' || tool?.startsWith('get_safe_scan_') || tool === 'explain_safe_scan_metric') return 'Safe Scan';
    if (tool === 'detection_updates' || tool?.startsWith('get_detection_') || tool === 'explain_detection_event_type' || tool === 'compare_detection_events') return 'Detection';
    if (tool === 'get_token_activity') return 'Token Activity';
    if (tool === 'get_smart_alert_status') return 'Intelligence Monitor';
    if (tool === 'alert_setup') return 'Intelligence Monitor';
    if (tool === 'unsupported_capability') return 'Coming Soon';
    if (tool === 'error') return 'Needs Attention';
    return 'Atlaix AI';
};

const toolIcon = (tool?: string) => {
    if (tool === 'get_token_deep_brief') return <Activity size={15} />;
    if (tool === 'get_wallet_deep_brief') return <User size={15} />;
    if (tool === 'get_platform_updates') return <Radar size={15} />;
    if (tool === 'run_safe_scan' || tool?.startsWith('get_safe_scan_') || tool === 'explain_safe_scan_metric') return <ShieldCheck size={15} />;
    if (tool === 'detection_updates' || tool?.startsWith('get_detection_') || tool === 'explain_detection_event_type' || tool === 'compare_detection_events') return <CheckCircle2 size={15} />;
    if (tool === 'get_smart_alert_status' || tool === 'alert_setup') return <Bell size={15} />;
    if (tool === 'unsupported_capability') return <AlertTriangle size={15} />;
    if (tool === 'error') return <AlertTriangle size={15} />;
    return <img src="/logo.png" alt="Atlaix" className="h-4 w-4 object-contain" />;
};

const promptToMessage = (prompt: string) => {
    if (prompt === 'What tokens are performing well?') return 'What tokens are performing well today?';
    if (prompt === 'Tokens with accumulation events') return 'Show me tokens with accumulation events';
    return 'Run a risk read on a token';
};

export const AiAssistantPage: React.FC = () => {
    const navigate = useNavigate();
    const handoffRef = useRef<AssistantHandoff | null>(loadAssistantHandoff());
    const cachedChatRef = useRef<AssistantChatCache | null>(loadAssistantChatCache());
    const pageContextRef = useRef<AiAssistantPageContext | null>(handoffRef.current?.pageContext || {
        route: '/ai-assistant',
        module: 'assistant',
        title: 'AI Market Analyst',
        systemContext: 'The user is on the full AI Market Analyst page. Continue the conversation naturally and use Atlaix tools when needed.',
        preferredTools: ['get_platform_updates', 'get_token_deep_brief', 'get_detection_updates', 'run_safe_scan', 'prepare_alert_setup']
    });
    const [provider, setProvider] = useState<AiAssistantProvider | null>(handoffRef.current?.provider || cachedChatRef.current?.provider || null);
    const [messages, setMessages] = useState<ChatMessage[]>(
        handoffRef.current?.messages?.length
            ? handoffRef.current.messages
            : cachedChatRef.current?.messages?.length ? cachedChatRef.current.messages : [createWelcomeMessage()]
    );
    const [draft, setDraft] = useState(handoffRef.current?.draft || cachedChatRef.current?.draft || '');
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, [messages, sending]);

    useEffect(() => {
        saveAssistantChatCache({ messages, draft, provider });
    }, [draft, messages, provider]);

    const goToAction = (href: string) => {
        if (href.startsWith('/')) {
            navigate(href);
            return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
    };

    const startNewChat = () => {
        setMessages([createWelcomeMessage()]);
        setDraft('');
    };

    const sendMessage = async (text = draft) => {
        const trimmed = text.trim();
        if (!trimmed || sending) return;

        const history = toConversationHistory(messages);
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            text: trimmed,
            createdAt: Date.now()
        };

        setDraft('');
        setSending(true);
        setMessages((current) => [...current, userMessage]);

        try {
            const response = await AiAssistantService.sendMessage(trimmed, history, pageContextRef.current);
            setProvider(response.provider);
            setMessages((current) => [
                ...current,
                {
                    id: response.id,
                    role: 'assistant',
                    text: normalizeAssistantText(response.answer),
                    tool: response.tool,
                    data: response.data,
                    actions: response.actions || [],
                    createdAt: new Date(response.createdAt).getTime() || Date.now()
                }
            ]);
        } catch (error) {
            setMessages((current) => [
                ...current,
                {
                    id: `assistant-error-${Date.now()}`,
                    role: 'assistant',
                    text: error instanceof Error ? error.message : 'I could not complete that request.',
                    tool: 'error',
                    createdAt: Date.now()
                }
            ]);
        } finally {
            setSending(false);
        }
    };

    const hasUserMessages = messages.some((message) => message.role === 'user');
    const conversationMode = hasUserMessages || sending;
    return (
        <div className="ai-assistant-page h-[calc(100vh-132px)] overflow-hidden rounded-xl border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.3)]">
            <div className="flex h-full">
                <section className="ai-assistant-stage relative flex min-w-0 flex-1 flex-col overflow-hidden bg-main">
                    <button
                        type="button"
                        onClick={startNewChat}
                        className="ai-assistant-new-chat-button"
                        aria-label="New assistant chat"
                        title="New chat"
                    >
                        <Plus size={18} />
                    </button>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                            <div className={`ai-assistant-chat-column mx-auto flex min-h-full w-full flex-col ${conversationMode ? 'justify-end gap-3 pb-2' : 'justify-center pb-12'}`}>
                                {!conversationMode ? (
                                    <div className="mx-auto w-full max-w-3xl text-center">
                                        <img
                                            src="/logo.png"
                                            alt="Atlaix"
                                            className="mx-auto mb-6 h-16 w-16 object-contain sm:h-20 sm:w-20"
                                            onError={(event) => { event.currentTarget.style.display = 'none'; }}
                                        />
                                        <h2 className="text-3xl font-black tracking-normal text-text-light sm:text-4xl">What's trending today?</h2>
                                        <div className="mx-auto mt-7 max-w-2xl">
                                            <form
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    sendMessage();
                                                }}
                                                className="ai-assistant-composer ai-assistant-hero-composer rounded-2xl border border-primary-green/25 bg-main/95 p-3 text-left shadow-[0_20px_70px_rgba(0,0,0,0.35)]"
                                            >
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
                                                    className="ai-assistant-textarea max-h-32 min-h-[48px] w-full resize-none bg-transparent px-1 py-1 text-base font-medium text-text-light outline-none placeholder:text-text-dark"
                                                />
                                                <div className="ai-assistant-composer-actions flex items-center justify-end gap-2">
                                                    <button
                                                        type="submit"
                                                        disabled={!draft.trim() || sending}
                                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-green text-main transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-45"
                                                        aria-label="Send assistant message"
                                                    >
                                                        <Send size={17} />
                                                    </button>
                                                </div>
                                            </form>
                                        </div>
                                        <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                            {SUGGESTED_PROMPTS.map((prompt) => (
                                                <button
                                                    key={prompt}
                                                    type="button"
                                                    onClick={() => sendMessage(promptToMessage(prompt))}
                                                    disabled={sending}
                                                    className="ai-assistant-prompt-chip min-h-[50px] rounded-xl border border-border bg-card px-4 py-3 text-left text-xs font-bold leading-snug text-text-medium transition-colors hover:border-primary-green/35 hover:bg-primary-green/10 hover:text-text-light disabled:cursor-not-allowed disabled:opacity-60"
                                                >
                                                    {prompt}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="mx-auto mb-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-text-dark">
                                            Today
                                        </div>

                                        {messages.map((message) => {
                                            const isUser = message.role === 'user';
                                            const inlineReferences = isUser ? [] : getAssistantDataReferences(message.data);
                                            return (
                                                <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                                    <div className={`flex max-w-[86%] gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                                                        {!isUser && (
                                                            <div className="mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary-green">
                                                                {toolIcon(message.tool)}
                                                            </div>
                                                        )}
                                                        <div className={`ai-assistant-message rounded-2xl px-4 py-3 shadow-sm ${
                                                            isUser
                                                                ? 'rounded-br-md bg-primary-green text-main'
                                                                : 'rounded-bl-md border border-border bg-card text-text-light'
                                                        }`}>
                                                            {!isUser && (
                                                                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-primary-green">
                                                                    {toolLabel(message.tool)}
                                                                </div>
                                                            )}
                                                            <div className={`space-y-2 text-sm leading-relaxed ${isUser ? 'font-semibold' : 'font-medium'}`}>
                                                                {splitLines(message.text).map((line, index) => {
                                                                    const reference = findInlineReference(line, inlineReferences);
                                                                    return (
                                                                        <p key={index} className="group/assistant-line flex items-start gap-2">
                                                                            <span className="min-w-0 flex-1">{line}</span>
                                                                            {reference && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => goToAction(reference.href)}
                                                                                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-primary-green/30 bg-primary-green/10 text-primary-green opacity-80 transition-colors hover:border-primary-green hover:bg-primary-green/15 hover:opacity-100"
                                                                                    title={reference.title}
                                                                                    aria-label={reference.title}
                                                                                >
                                                                                    <ExternalLink size={12} />
                                                                                </button>
                                                                            )}
                                                                        </p>
                                                                    );
                                                                })}
                                                            </div>
                                                            {message.actions && message.actions.length > 0 && (
                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    {message.actions.map((action) => (
                                                                        <button
                                                                            key={`${message.id}-${action.label}-${action.href}`}
                                                                            type="button"
                                                                            onClick={() => goToAction(action.href)}
                                                                            className="inline-flex items-center gap-2 rounded-lg border border-primary-green/30 bg-primary-green/10 px-3 py-1.5 text-xs font-bold text-primary-green transition-colors hover:border-primary-green"
                                                                            title={action.confirmationRequired ? 'Opens a review step before anything is saved' : undefined}
                                                                        >
                                                                            {action.label}{action.confirmationRequired ? ' (review)' : ''} <ArrowRight size={13} />
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            <div className={`mt-2 text-right text-[10px] ${isUser ? 'text-main/60' : 'text-text-dark'}`}>
                                                                {formatClock(message.createdAt)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {sending && (
                                            <div className="flex justify-start">
                                                <div className="flex items-end gap-2">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-primary-green">
                                                        <img src="/logo.png" alt="Atlaix" className="h-4 w-4 object-contain" />
                                                    </div>
                                                    <div className="rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3 text-sm font-semibold text-text-medium">
                                                        <Loader2 size={15} className="mr-2 inline animate-spin" />
                                                        Thinking
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div ref={messagesEndRef} />
                                    </>
                                )}
                            </div>
                    </div>

                    {conversationMode && <div className="shrink-0 border-t border-border bg-card/90 p-4 backdrop-blur">
                        <div className="ai-assistant-chat-column mx-auto">
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    sendMessage();
                                }}
                            >
                                <div className="ai-assistant-composer flex items-center gap-3">
                                    <textarea
                                        value={draft}
                                        onChange={(event) => setDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' && !event.shiftKey) {
                                                event.preventDefault();
                                                sendMessage();
                                            }
                                        }}
                                        placeholder="Message Atlaix AI"
                                        className="ai-assistant-textarea max-h-32 min-h-[52px] flex-1 resize-none rounded-2xl border border-border bg-main px-4 py-[14px] text-sm font-medium text-text-light outline-none transition-colors placeholder:text-text-dark focus:border-primary-green/60"
                                    />
                                    <div className="ai-assistant-composer-actions flex shrink-0 items-center gap-3 self-center">
                                        <button
                                            type="submit"
                                            disabled={!draft.trim() || sending}
                                            className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-green text-main transition-colors hover:bg-primary-green/90 disabled:cursor-not-allowed disabled:opacity-50"
                                            aria-label="Send assistant message"
                                        >
                                            <Send size={18} />
                                        </button>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>}
                </section>
            </div>
        </div>
    );
};
