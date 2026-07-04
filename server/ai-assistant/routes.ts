import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readEnv } from '../env';
import type { DetectionEvent, DetectionSeverity, DetectionSentiment } from '../../src/shared/detection';
import { detectionEventAssessmentForLabel, detectionEventSummaryForLabel } from '../../src/shared/detection-copy';
import type { BubblemapsChain, BubblemapsScanReport, ClusterData, TokenHolder } from '../../src/shared/bubblemaps';
import { DetectionStore } from '../detection/store';
import { sendJson, sendNotFound } from '../http/response';
import { BubblemapsClient } from '../bubblemaps/client';
import { BubblemapsReportService } from '../bubblemaps/report-service';
import { getOverviewFeed, getOverviewTokenDetails, searchOverviewTokens } from '../overview/database';
import type { SmartAlertRoutes } from '../smart-alerts/routes';
import { WalletPortfolioService } from '../wallet/service';
import { OPENROUTER_TOOLS, isAssistantToolName, validateAssistantToolArgs } from './tools';

type AiAssistantAction = {
  label: string;
  href: string;
  kind?: 'navigate' | 'draft' | 'confirmable' | 'handoff';
  confirmationRequired?: boolean;
  payload?: unknown;
};

type AiAssistantConversationMessage = {
  role: 'user' | 'assistant';
  text: string;
};

type AiAssistantPageModule =
  | 'dashboard'
  | 'detection'
  | 'token'
  | 'wallet'
  | 'smart-money'
  | 'smart-alerts'
  | 'safe-scan'
  | 'narrative'
  | 'assistant'
  | 'settings'
  | 'unknown';

type AiAssistantPageContext = {
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

type AiAssistantToolName =
  | 'conversation'
  | 'get_token_overview'
  | 'get_token_deep_brief'
  | 'get_token_profile'
  | 'get_wallet_deep_brief'
  | 'get_platform_updates'
  | 'get_detection_events'
  | 'get_detection_summary'
  | 'get_detection_token_recent_events'
  | 'get_detection_token_history'
  | 'get_detection_event_detail'
  | 'explain_detection_event_type'
  | 'compare_detection_events'
  | 'run_safe_scan'
  | 'get_safe_scan_brief'
  | 'get_safe_scan_holders'
  | 'get_safe_scan_clusters'
  | 'explain_safe_scan_metric'
  | 'prepare_alert_setup'
  | 'get_smart_alert_status'
  | 'open_token_details';

type AiAssistantToolRequest = {
  tool: AiAssistantToolName;
  address?: string;
  chain?: string;
  query?: string;
  eventType?: string;
  metricName?: string;
  severity?: DetectionSeverity | 'all';
  sentiment?: DetectionSentiment | 'all';
  responseStyle?: 'brief' | 'detailed';
};

type AiAssistantToolResult = {
  answer: string;
  tool: string;
  data?: unknown;
  actions?: AiAssistantAction[];
};

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NETWORK_BY_CHAIN: Record<string, string> = {
  ethereum: 'eth',
  eth: 'eth',
  base: 'base',
  bsc: 'bsc',
  binance: 'bsc',
  solana: 'solana',
  sol: 'solana',
  polygon: 'polygon',
  avalanche: 'avalanche',
  arbitrum: 'arbitrum'
};

const DETECTION_TOOL_NAMES = new Set([
  'get_detection_events',
  'get_detection_summary',
  'get_detection_token_recent_events',
  'get_detection_token_history',
  'get_detection_event_detail',
  'explain_detection_event_type',
  'compare_detection_events'
]);

const SAFE_SCAN_TOOL_NAMES = new Set([
  'run_safe_scan',
  'get_safe_scan_brief',
  'get_safe_scan_holders',
  'get_safe_scan_clusters',
  'explain_safe_scan_metric'
]);

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function getProvider() {
  const model = readEnv('OPENROUTER_MODEL') || null;
  const configured = Boolean(readEnv('OPENROUTER_API_KEY') && model);
  return {
    configured,
    model,
    mode: configured ? 'model-tool-calling' : 'unconfigured'
  };
}

function compactAddress(value = '') {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeChain(value = '') {
  const chain = value.trim().toLowerCase();
  if (chain === 'eth') return 'ethereum';
  if (chain === 'bnb' || chain === 'binance') return 'bsc';
  if (chain === 'sol') return 'solana';
  return chain;
}

function toBubblemapsChain(chain = '', address = ''): BubblemapsChain {
  const normalized = normalizeChain(chain);
  if (NETWORK_BY_CHAIN[normalized]) return NETWORK_BY_CHAIN[normalized] as BubblemapsChain;
  return SOLANA_ADDRESS_REGEX.test(address) && !address.startsWith('0x') ? 'solana' : 'eth';
}

function normalizePageContext(value: unknown): AiAssistantPageContext | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<AiAssistantPageContext>;
  return {
    route: String(raw.route || '').slice(0, 200),
    module: raw.module || 'unknown',
    title: String(raw.title || 'Atlaix').slice(0, 120),
    systemContext: String(raw.systemContext || '').slice(0, 900),
    subjectKind: raw.subjectKind,
    subjectAddress: String(raw.subjectAddress || '').slice(0, 140),
    subjectChain: String(raw.subjectChain || '').slice(0, 40),
    pairAddress: String(raw.pairAddress || '').slice(0, 140),
    preferredTools: Array.isArray(raw.preferredTools) ? raw.preferredTools.slice(0, 8).map(String) : undefined,
    visibleSnapshot: raw.visibleSnapshot
  };
}

function parseNumber(value: unknown) {
  const raw = String(value ?? '').replace(/[$,%+,]/g, '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeToolRequest(request: AiAssistantToolRequest): AiAssistantToolRequest {
  if (request.tool === 'get_detection_events' || request.tool === 'get_detection_summary') {
    const query = String(request.query || '').toLowerCase();
    const chain = normalizeChain(String(request.chain || ''));
    const validChains = new Set(['ethereum', 'base', 'bsc', 'solana', 'arbitrum', 'optimism', 'polygon', 'avalanche']);
    if (/\b(detection|engine|event|events|latest|recent|newest|current|summary|overview)\b/.test(query)) {
      return { ...request, query: '', chain: validChains.has(chain) ? chain : '' };
    }
    if (request.chain && !validChains.has(chain)) return { ...request, chain: '' };
  }
  return request;
}

function formatUsd(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'unavailable';
  if (numeric >= 1e9) return `$${(numeric / 1e9).toFixed(2)}B`;
  if (numeric >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  if (numeric >= 1e3) return `$${(numeric / 1e3).toFixed(2)}K`;
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
}

function formatSignedUsd(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '$0';
  return `${numeric > 0 ? '+' : '-'}${formatUsd(Math.abs(numeric))}`;
}

function formatPercent(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric)) return 'unavailable';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}%`;
}

function formatScanPercent(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric)) return 'unavailable';
  const percent = numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  return `${percent.toFixed(percent >= 10 ? 1 : 2)}%`;
}

function normalizeScanPercentNumber(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function holderAddress(holder: TokenHolder | undefined | null) {
  return String(holder?.address || '').trim();
}

function holderAmount(holder: TokenHolder | undefined | null) {
  const numeric = Number(holder?.holder_data?.amount);
  return Number.isFinite(numeric) ? numeric : 0;
}

function holderPercent(holder: TokenHolder | undefined | null) {
  return normalizeScanPercentNumber(holder?.holder_data?.share);
}

function clusterPercent(cluster: ClusterData | undefined | null) {
  return normalizeScanPercentNumber(cluster?.share);
}

function formatTokenAmount(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'unavailable';
  if (numeric >= 1e12) return `${(numeric / 1e12).toFixed(2)}T`;
  if (numeric >= 1e9) return `${(numeric / 1e9).toFixed(2)}B`;
  if (numeric >= 1e6) return `${(numeric / 1e6).toFixed(2)}M`;
  if (numeric >= 1e3) return `${(numeric / 1e3).toFixed(2)}K`;
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function safeScanFacts(report: BubblemapsScanReport) {
  const token = report.endpoints.token.data;
  const metrics = report.endpoints.metrics.data || report.endpoints.map.data?.metrics || null;
  const holders = (report.endpoints.holders.data || report.endpoints.map.data?.nodes?.top_holders || [])
    .slice()
    .sort((left, right) => Number(right.holder_data?.share || 0) - Number(left.holder_data?.share || 0));
  const clusters = (report.endpoints.map.data?.clusters || [])
    .slice()
    .sort((left, right) => Number(right.share || 0) - Number(left.share || 0));
  const largestHolder = holders[0];
  const largestCluster = clusters[0];
  const score = metrics?.scores?.bubblemaps_score;
  const supply = metrics?.supply_stats;

  return {
    chain: report.chain,
    address: report.address,
    label: token?.metadata?.symbol || token?.metadata?.name || compactAddress(report.address),
    tokenName: token?.metadata?.name || '',
    tokenSymbol: token?.metadata?.symbol || '',
    indexed: token?.metadata?.is_indexed,
    transfers: token?.stats?.transfers_count,
    score: typeof score === 'number' ? score : null,
    gini: metrics?.scores?.gini_index ?? null,
    hhi: metrics?.scores?.herfindahl_hirschman_index ?? null,
    nakamoto: metrics?.scores?.nakamoto_coefficient ?? null,
    supply,
    holders,
    clusters,
    largestHolder,
    largestCluster,
    endpointStatus: {
      token: report.endpoints.token.status,
      metrics: report.endpoints.metrics.status,
      holders: report.endpoints.holders.status,
      map: report.endpoints.map.status
    }
  };
}

function safeScanRiskRead(facts: ReturnType<typeof safeScanFacts>) {
  const warnings: string[] = [];
  const score = Number(facts.score);
  const nakamoto = Number(facts.nakamoto);
  const largestClusterShare = clusterPercent(facts.largestCluster);
  const largestHolderShare = holderPercent(facts.largestHolder);

  if (Number.isFinite(score) && score < 40) warnings.push('low Bubblemaps score');
  if (Number.isFinite(nakamoto) && nakamoto <= 1) warnings.push('one entity may control 50% of supply');
  else if (Number.isFinite(nakamoto) && nakamoto <= 3) warnings.push('few entities may control 50% of supply');
  if (largestClusterShare !== null && largestClusterShare >= 50) warnings.push(`largest cluster controls ${formatScanPercent(largestClusterShare)}`);
  if (largestHolderShare !== null && largestHolderShare >= 10) warnings.push(`largest holder controls ${formatScanPercent(largestHolderShare)}`);

  if (!warnings.length) return 'No single Safe Scan metric is flashing severe concentration risk, but still compare holder clusters with liquidity and recent trading.';
  return `Main Safe Scan concern: ${warnings.join(', ')}.`;
}

function safeScanMetricExplanation(metricName = '') {
  const key = metricName.toLowerCase();
  if (key.includes('gini')) return 'Gini measures holder inequality. Higher values mean ownership is less evenly distributed.';
  if (key.includes('hhi') || key.includes('concentration')) return 'HHI measures concentration. Higher values mean fewer wallets or entities dominate supply.';
  if (key.includes('nakamoto')) return 'Nakamoto shows how many entities are needed to control 50% of supply. A value of 1 is a major centralization warning.';
  if (key.includes('score')) return 'Bubblemaps score summarizes distribution quality. Lower scores point to concentration or connected-wallet risk.';
  if (key.includes('cluster')) return 'A cluster is a group of linked wallets. A large cluster can mean one coordinated entity controls more supply than it appears.';
  if (key.includes('holder')) return 'Largest holder shows direct single-wallet exposure. Large holder share raises sell-pressure and control risk.';
  if (key.includes('supply') || key.includes('cex') || key.includes('dex') || key.includes('contract') || key.includes('bundle')) return 'Supply exposure shows where token supply sits: exchanges, DEX wallets, contracts, fresh wallets, bundled holders, and adjusted top holders.';
  return 'Safe Scan reads token distribution, holder concentration, supply exposure, and linked wallet clusters from Bubblemaps.';
}

function formatAge(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function eventTokenLabel(event: DetectionEvent) {
  return event.token.ticker || event.token.name || compactAddress(event.token.address);
}

function detectionEventLine(event: DetectionEvent, index?: number) {
  const prefix = typeof index === 'number' ? `${index + 1}. ` : '';
  return `${prefix}${eventTokenLabel(event)} on ${event.token.chain || 'unknown'}: ${event.eventType}, ${event.severity} severity, score ${Math.round(event.score)}, liquidity ${formatUsd(event.metrics.liquidity)}, net flow ${formatSignedUsd(event.metrics.netFlow)}, ${formatAge(event.detectedAt)}.`;
}

function detectionMeaning(event: DetectionEvent) {
  return detectionEventAssessmentForLabel(event.eventType, eventTokenLabel(event), event.summary || detectionEventSummaryForLabel(event.eventType, 'The engine found an attention signal.'));
}

function detectionNextCheck(event: DetectionEvent) {
  const lower = event.eventType.toLowerCase();
  if (lower.includes('liquidity drain')) return 'Next check: watch whether liquidity returns or keeps shrinking. Continued depth loss raises slippage risk.';
  if (lower.includes('distribution')) return 'Next check: watch whether buyers absorb sell pressure or price fails to reclaim range.';
  if (lower.includes('accumulation')) return 'Next check: watch whether buy dominance holds while liquidity stays deep.';
  if (lower.includes('breakout')) return 'Next check: watch whether price holds the breakout area with volume behind it.';
  if (lower.includes('breakdown')) return 'Next check: watch whether buyers reclaim support or sell volume confirms the break.';
  if (event.sentiment === 'bullish') return 'Next check: watch follow-through in volume, liquidity, and price support.';
  if (event.sentiment === 'bearish') return 'Next check: watch sell pressure, liquidity depth, and whether buyers reclaim control.';
  return 'Next check: wait for clearer volume, liquidity, and price confirmation.';
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function tokenLabel(token: any) {
  return token?.baseToken?.symbol || token?.baseToken?.name || token?.token || token?.ticker || 'this token';
}

async function resolveToken(query: string, chain = '', pairAddress = '') {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (EVM_ADDRESS_REGEX.test(trimmed) || SOLANA_ADDRESS_REGEX.test(trimmed)) {
    const details = await getOverviewTokenDetails(trimmed, normalizeChain(chain), pairAddress).catch(() => null);
    return details?.pair ? { pair: details.pair, pairs: details.pairs || [] } : null;
  }

  const candidates = await searchOverviewTokens(trimmed).catch(() => []);
  const normalizedChain = normalizeChain(chain);
  const candidate = candidates.find((item: any) => !normalizedChain || normalizeChain(item.chain) === normalizedChain) || candidates[0];
  if (!candidate?.address) return null;
  const details = await getOverviewTokenDetails(candidate.address, candidate.chain || normalizedChain, candidate.pairAddress || '').catch(() => null);
  return details?.pair ? { pair: details.pair, pairs: details.pairs || [], candidate } : null;
}

function tokenProfileAddress(pair: any, request: AiAssistantToolRequest) {
  return pair?.baseToken?.address || request.address || request.query || '';
}

async function callOpenRouter(system: string, messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, timeoutMs = 18_000) {
  const apiKey = readEnv('OPENROUTER_API_KEY');
  const model = readEnv('OPENROUTER_MODEL');
  if (!apiKey || !model) return '';
  const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Atlaix AI Assistant'
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      messages: [{ role: 'system', content: system }, ...messages]
    })
  }, timeoutMs);
  if (!response.ok) throw new Error(`OpenRouter failed with ${response.status}.`);
  const payload = await response.json();
  return String(payload?.choices?.[0]?.message?.content || '').trim();
}

function parseToolArguments(value: unknown) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function chooseToolWithModel(
  message: string,
  history: AiAssistantConversationMessage[],
  pageContext: AiAssistantPageContext | null
): Promise<{ request?: AiAssistantToolRequest; answer?: string }> {
  const provider = getProvider();
  if (provider.mode !== 'model-tool-calling') return {};

  const apiKey = readEnv('OPENROUTER_API_KEY');
  const model = readEnv('OPENROUTER_MODEL');
  if (!apiKey || !model) return {};

  const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
  const explicitDetectionEngine = /\bdetection engine\b/i.test(message) || pageContext?.module === 'detection';
  const explicitSafeScan = /\b(safe\s*scan|bubblemaps?|holder concentration|largest holder|largest cluster|nakamoto|gini|hhi|supply exposure|linked wallets?)\b/i.test(message) || pageContext?.module === 'safe-scan';
  const wantsLatestDetectionEvent = explicitDetectionEngine && /\b(latest|most recent|newest|current)\b/i.test(message) && /\b(event|events)\b/i.test(message);
  const tools = explicitDetectionEngine
    ? OPENROUTER_TOOLS.filter((tool) => wantsLatestDetectionEvent ? tool.function.name === 'get_detection_events' : DETECTION_TOOL_NAMES.has(tool.function.name))
    : explicitSafeScan
      ? OPENROUTER_TOOLS.filter((tool) => SAFE_SCAN_TOOL_NAMES.has(tool.function.name))
    : OPENROUTER_TOOLS;
  const system = [
    'You are Atlaix AI inside a crypto intelligence app.',
    'Choose the best available tool when Atlaix data is needed. Understand typos, shorthand, and page context.',
    'Use page context for phrases such as "this token", "this wallet", "that one", or "it".',
    'Detection Engine questions about latest events, flagged tokens, event detail, scores, severity, or signals must use a Detection tool.',
    'For broad Detection Engine questions like "latest event" or "what is Detection seeing", no token is required.',
    'Safe Scan questions about Bubblemaps score, Gini, HHI, Nakamoto, holders, supply exposure, clusters, linked wallets, or token safety must use a Safe Scan tool.',
    'Smart Alert tools are only for alert setup, saved alert rules, alert runner status, and alert health. They are not Detection Engine event tools.',
    'Platform update tools are for broad market updates only. They are not Detection Engine event tools.',
    'Use prepare_alert_setup only to draft alert setup. The user must confirm before anything is saved.',
    'If a required token, wallet, chain, or address is missing, ask one direct question instead of guessing.',
    'Do not invent Atlaix data. Do not call tools for normal small talk or product help that needs no data.',
    ASSISTANT_VOICE_RULES,
    pageContext?.systemContext || ''
  ].join('\n');

  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Atlaix AI Assistant'
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      tool_choice: explicitDetectionEngine || explicitSafeScan ? 'required' : 'auto',
      tools,
      messages: [
        { role: 'system', content: system },
        ...history.slice(-8).map((item) => ({ role: item.role, content: item.text })),
        {
          role: 'user',
          content: [
            `Current page context: ${JSON.stringify(pageContext || null).slice(0, 3500)}`,
            `User message: ${message}`
          ].join('\n\n')
        }
      ]
    })
  }, 18_000);

  if (!response.ok) throw new Error(`OpenRouter tool selection failed with ${response.status}.`);
  const payload = await response.json();
  const choiceMessage = payload?.choices?.[0]?.message || {};
  const toolCall = Array.isArray(choiceMessage.tool_calls) ? choiceMessage.tool_calls[0] : null;
  const toolName = String(toolCall?.function?.name || '');
  if (toolName && isAssistantToolName(toolName)) {
    return {
      request: {
        tool: toolName,
        ...validateAssistantToolArgs(parseToolArguments(toolCall?.function?.arguments))
      }
    };
  }

  const answer = normalizeAssistantText(choiceMessage.content || '');
  return answer ? { answer } : {};
}

function fallbackConversation(pageContext?: AiAssistantPageContext | null) {
  const title = pageContext?.title || 'Atlaix';
  return [
    `I am ready on ${title}.`,
    'Ask me about token performance, Detection Engine events, wallet holdings, Safe Scan risk, Smart Alerts, or current market activity.'
  ].join('\n');
}

function toolCallingUnavailable() {
  return [
    'Atlaix AI needs OpenRouter tool calling before it can answer with live app data.',
    'Set OPENROUTER_API_KEY and OPENROUTER_MODEL, then restart the dev server.'
  ].join('\n');
}

function normalizeAssistantText(value: unknown) {
  return String(value || '')
    .replace(/(^|[^\w])\*\*([^*\n]+?)\*\*/g, '$1$2')
    .replace(/(^|[^\w])\*([^*\n]+?)\*/g, '$1$2')
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/\*{2,}/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

const ASSISTANT_VOICE_RULES = [
  'Voice rules:',
  'Write like a sharp product analyst talking to one person, not like a generic chatbot.',
  'Do not start with filler such as "Sure", "Certainly", "Absolutely", "Here is", "Here are", or "Great question".',
  'Do not announce what you are about to do. Give the answer.',
  'Use active voice. Name the actor, token, wallet, chain, or signal when you can.',
  'Be specific. Avoid vague phrases such as "it depends", "significant implications", "robust solution", "delve", "leverage", "seamless", and "comprehensive".',
  'Avoid formulaic wrap-ups, motivational lines, disclaimers, and canned closing sentences.',
  'Vary sentence length. Keep paragraphs short. Use numbered lines only when the user asks for steps or choices.',
  'If you need missing info, ask one direct question and explain why in one sentence.',
  'Use plain text only. Do not use markdown, markdown tables, emoji, asterisks, bold formatting, or em dashes.'
].join('\n');

async function synthesize(message: string, history: AiAssistantConversationMessage[], pageContext: AiAssistantPageContext | null, result: AiAssistantToolResult) {
  if (!getProvider().configured || result.tool === 'conversation') return result;
  try {
    const content = await callOpenRouter(
      [
        'You are Atlaix AI inside a crypto intelligence app.',
        'Answer using only the supplied Atlaix data. Do not invent prices, holder data, endpoints, or trading advice.',
        'Keep the answer concise, direct, and useful.',
        ASSISTANT_VOICE_RULES,
        pageContext?.systemContext || ''
      ].join('\n'),
      [
        ...history.slice(-6).map((item) => ({ role: item.role, content: item.text }) as { role: 'user' | 'assistant'; content: string }),
        {
          role: 'user',
          content: [
            `User question: ${message}`,
            `Tool: ${result.tool}`,
            `Draft answer: ${result.answer}`,
            `Atlaix data: ${JSON.stringify(result.data || null).slice(0, 9000)}`
          ].join('\n\n')
        }
      ]
    );
    return content ? { ...result, answer: normalizeAssistantText(content) } : result;
  } catch {
    return result;
  }
}

export class AiAssistantRoutes {
  private readonly detectionStore = new DetectionStore();
  private readonly walletService = new WalletPortfolioService();
  private readonly safeScanService = new BubblemapsReportService(new BubblemapsClient());

  constructor(private readonly smartAlerts: SmartAlertRoutes) {}

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();

    if (method === 'GET' && requestUrl.pathname === '/api/ai-assistant/notifications') {
      const status = this.smartAlerts.runner.getStatus();
      const notifications = status.lastRunStatus || status.lastError ? [{
        id: `smart-alert-status-${status.lastRunCompletedAt || status.lastRunStartedAt || 'pending'}`,
        title: 'Smart Alerts status',
        body: status.lastError
          ? `Latest alert evaluation needs attention: ${status.lastError}`
          : `Latest alert run ${status.lastRunStatus || 'is pending'} after checking ${status.rulesChecked || 0} rules.`,
        tone: status.lastError ? 'risk' : 'neutral',
        href: '/smart-alerts',
        timestamp: status.lastRunCompletedAt ? new Date(status.lastRunCompletedAt).getTime() : Date.now()
      }] : [];
      sendJson(response, 200, { notifications, provider: getProvider(), generatedAt: new Date().toISOString() });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/ai-assistant/chat') {
      const body = await readJsonBody(request) as { message?: string; history?: AiAssistantConversationMessage[]; pageContext?: unknown };
      const message = String(body.message || '').trim();
      if (!message) {
        sendJson(response, 400, { error: 'message is required.' });
        return;
      }
      const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const pageContext = normalizePageContext(body.pageContext);
      const result = await synthesize(message, history, pageContext, await this.buildResponse(message, history, pageContext));
      sendJson(response, 200, {
        id: randomUUID(),
        role: 'assistant',
        createdAt: new Date().toISOString(),
        provider: getProvider(),
        ...result,
        answer: normalizeAssistantText(result.answer)
      });
      return;
    }

    sendNotFound(response);
  }

  private detectionFilters(request: AiAssistantToolRequest): {
    q?: string;
    chain?: string;
    severity?: DetectionSeverity | 'all';
    sentiment?: DetectionSentiment | 'all';
    limit: number;
  } {
    const q = request.query && !request.address && !request.eventType ? request.query : undefined;
    return {
      q,
      chain: request.chain || undefined,
      severity: request.severity,
      sentiment: request.sentiment,
      limit: 100
    };
  }

  private async resolveDetectionEvents(request: AiAssistantToolRequest, limit = 8) {
    const response = await this.detectionStore.listEvents({
      ...this.detectionFilters(request),
      q: request.address || this.detectionFilters(request).q,
      limit: 250
    });
    const eventType = request.eventType?.toLowerCase();
    const events = response.events
      .filter((event) => !eventType || event.eventType.toLowerCase().includes(eventType))
      .slice(0, limit);
    if (events.length || !request.query || request.address) return events;

    const candidates = await searchOverviewTokens(request.query).catch(() => []);
    for (const candidate of candidates.slice(0, 4) as any[]) {
      const address = String(candidate?.address || '').trim();
      if (!address) continue;
      const tokenEvents = await this.detectionStore.listTokenEvents(address, 100).catch(() => []);
      const matchingEvents = tokenEvents
        .filter((event) => (!request.chain || event.token.chain.toLowerCase() === request.chain.toLowerCase()) && (!eventType || event.eventType.toLowerCase().includes(eventType)))
        .slice(0, limit);
      if (matchingEvents.length) return matchingEvents;
    }

    return events;
  }

  private async resolveDetectionTokenEvents(request: AiAssistantToolRequest) {
    const address = request.address || (EVM_ADDRESS_REGEX.test(request.query || '') || SOLANA_ADDRESS_REGEX.test(request.query || '') ? request.query || '' : '');
    if (address) return this.detectionStore.listTokenEvents(address, 100);

    const events = await this.resolveDetectionEvents(request, 1);
    return events[0]?.token.address ? this.detectionStore.listTokenEvents(events[0].token.address, 100) : [];
  }

  private async answerDetectionTokenRecentEvents(request: AiAssistantToolRequest): Promise<AiAssistantToolResult> {
    const events = (await this.resolveDetectionTokenEvents(request)).slice(0, 5);
    if (!events.length) {
      return {
        answer: 'I could not find recent Detection Engine events for that token yet. Try a contract address or open the token from Detection Engine first.',
        tool: 'get_detection_token_recent_events',
        actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
      };
    }

    return {
      answer: `Found ${events.length} recent Detection Engine event${events.length === 1 ? '' : 's'} for ${eventTokenLabel(events[0])}.`,
      tool: 'get_detection_token_recent_events',
      data: {
        token: events[0].token,
        events
      },
      actions: this.buildDetectionActions(events[0])
    };
  }

  private async resolveTokenProfile(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null) {
    const query = request.query || request.address || pageContext?.subjectAddress || '';
    const chain = request.chain || pageContext?.subjectChain || '';
    const token = query ? await resolveToken(query, chain, pageContext?.pairAddress).catch(() => null) : null;
    const pair = token?.pair as any;
    const address = tokenProfileAddress(pair, request);
    const detectionRequest = {
      ...request,
      address: request.address || pair?.baseToken?.address || '',
      query: pair?.baseToken?.symbol || pair?.baseToken?.name || request.query || address,
      chain: pair?.chainId || chain
    };
    const detectionEvents = await this.resolveDetectionEvents(detectionRequest, 8).catch(() => []);

    if (pair || detectionEvents.length) {
      return { token, pair, address: pair?.baseToken?.address || detectionEvents[0]?.token.address || address, detectionEvents };
    }

    const events = await this.resolveDetectionEvents(request, 8).catch(() => []);
    if (!events.length) return { token: null, pair: null, address, detectionEvents: [] as DetectionEvent[] };

    const event = events[0];
    const eventToken = event.token;
    const eventOverview = eventToken.address
      ? await resolveToken(eventToken.address, eventToken.chain, eventToken.pairAddress).catch(() => null)
      : null;
    return {
      token: eventOverview,
      pair: eventOverview?.pair as any,
      address: eventToken.address || address,
      detectionEvents: events
    };
  }

  private buildDetectionActions(event?: DetectionEvent): AiAssistantAction[] {
    if (!event?.token.address) return [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }];
    return [{
      label: 'Open Detection Detail',
      href: `/detection/token/${encodeURIComponent(event.token.chain)}/${encodeURIComponent(event.token.address)}?${new URLSearchParams({ pair: event.token.pairAddress || '' }).toString()}`,
      kind: 'navigate'
    }];
  }

  private async answerDetectionEvents(request: AiAssistantToolRequest): Promise<AiAssistantToolResult> {
    const events = await this.resolveDetectionEvents(request, 8);
    if (!events.length) {
      return {
        answer: 'I do not see matching Detection Engine events yet. Try a broader chain, severity, token, or event type.',
        tool: 'get_detection_events',
        actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
      };
    }

    return {
      answer: [
        `I found ${events.length} matching Detection Engine event${events.length === 1 ? '' : 's'}.`,
        events.map(detectionEventLine).join('\n')
      ].join('\n'),
      tool: 'get_detection_events',
      data: { events },
      actions: this.buildDetectionActions(events[0])
    };
  }

  private async answerDetectionSummary(request: AiAssistantToolRequest): Promise<AiAssistantToolResult> {
    const summary = await this.detectionStore.getDetectionSummary(this.detectionFilters(request));
    if (!summary.total) {
      return {
        answer: 'Detection Engine has no recent events for that scope yet.',
        tool: 'get_detection_summary',
        actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
      };
    }

    const topSeverity = Object.entries(summary.bySeverity).sort((left, right) => right[1] - left[1])[0];
    const topType = Object.entries(summary.byEventType).sort((left, right) => right[1] - left[1])[0];
    const topChain = Object.entries(summary.byChain).sort((left, right) => right[1] - left[1])[0];
    const riskLines = summary.topRisk.slice(0, 3).map(detectionEventLine).join('\n');
    const bullishLines = summary.topBullish.slice(0, 2).map(detectionEventLine).join('\n');

    return {
      answer: [
        `Detection Engine has ${summary.total} recent event${summary.total === 1 ? '' : 's'} in this scope.`,
        `Most common severity: ${topSeverity ? `${topSeverity[0]} (${topSeverity[1]})` : 'unavailable'}. Most common event: ${topType ? `${topType[0]} (${topType[1]})` : 'unavailable'}. Most active chain: ${topChain ? `${topChain[0]} (${topChain[1]})` : 'unavailable'}.`,
        riskLines ? `Highest-risk reads:\n${riskLines}` : '',
        bullishLines ? `Bullish reads:\n${bullishLines}` : ''
      ].filter(Boolean).join('\n'),
      tool: 'get_detection_summary',
      data: summary,
      actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
    };
  }

  private async answerDetectionTokenHistory(request: AiAssistantToolRequest): Promise<AiAssistantToolResult> {
    const events = await this.resolveDetectionTokenEvents(request);
    if (!events.length) {
      return {
        answer: 'I could not find Detection Engine history for that token yet. Try a contract address or a token that appears in the Detection feed.',
        tool: 'get_detection_token_history',
        actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
      };
    }

    const latest = events[0];
    return {
      answer: [
        `${eventTokenLabel(latest)} has ${events.length} recent Detection Engine event${events.length === 1 ? '' : 's'} on record.`,
        events.slice(0, 6).map(detectionEventLine).join('\n'),
        `Latest read: ${detectionMeaning(latest)}`,
        detectionNextCheck(latest)
      ].join('\n'),
      tool: 'get_detection_token_history',
      data: { events },
      actions: this.buildDetectionActions(latest)
    };
  }

  private async answerDetectionEventDetail(request: AiAssistantToolRequest): Promise<AiAssistantToolResult> {
    const query = request.address || request.query || request.eventType || '';
    const event = await this.detectionStore.getEventDetail(query) || (await this.resolveDetectionEvents(request, 1))[0] || null;
    if (!event) {
      return {
        answer: 'I could not find that Detection Engine event. Try the token ticker, contract address, event type, or open the Detection page first.',
        tool: 'get_detection_event_detail',
        actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
      };
    }

    const detail = event.token.chain && event.token.address
      ? await withTimeout(this.detectionStore.getTokenDetail(event.token.chain, event.token.address, event.token.pairAddress).catch(() => null), 2_000, null)
      : null;
    const classification = detail?.latestClassification as any;
    const evidence = Array.isArray(classification?.evidence) ? classification.evidence.slice(0, 3).join(' ') : '';
    const warnings = Array.isArray(classification?.warnings) ? classification.warnings.slice(0, 2).join(' ') : '';

    return {
      answer: [
        `${eventTokenLabel(event)} was flagged for ${event.eventType} ${formatAge(event.detectedAt)}.`,
        `Severity: ${event.severity}. Score: ${Math.round(event.score)}. Sentiment: ${event.sentiment}. Liquidity: ${formatUsd(event.metrics.liquidity)}. Volume: ${formatUsd(event.metrics.volume24h)}. Net flow: ${formatSignedUsd(event.metrics.netFlow)}. 24h move: ${formatPercent(event.metrics.priceChange24h)}.`,
        detectionMeaning(event),
        evidence ? `Evidence: ${evidence}` : `Evidence: ${event.summary || detectionEventSummaryForLabel(event.eventType, 'The event matched Detection Engine conditions.')}`,
        warnings ? `Warnings: ${warnings}` : '',
        detectionNextCheck(event)
      ].filter(Boolean).join('\n'),
      tool: 'get_detection_event_detail',
      data: { event, detail },
      actions: this.buildDetectionActions(event)
    };
  }

  private answerDetectionEventType(request: AiAssistantToolRequest): AiAssistantToolResult {
    const eventType = request.eventType || 'Detection Event';
    const summary = detectionEventSummaryForLabel(eventType, `${eventType} is an attention signal from the Detection Engine.`);
    const assessment = detectionEventAssessmentForLabel(eventType, 'A token', summary);
    return {
      answer: [
        `${eventType}: ${summary}`,
        assessment.replace(/^A token is showing /, 'It means the token is showing '),
        'Use it as a watch signal, not a buy or sell command. Check liquidity, volume, net flow, severity, and whether the next scan confirms or weakens the read.'
      ].join('\n'),
      tool: 'explain_detection_event_type',
      data: { eventType, summary }
    };
  }

  private async answerDetectionComparison(request: AiAssistantToolRequest): Promise<AiAssistantToolResult> {
    const events = await this.resolveDetectionEvents(request, 20);
    const bullish = events.find((event) => event.sentiment === 'bullish') || events[0];
    const bearish = events.find((event) => event.sentiment === 'bearish');
    if (!bullish || !bearish) {
      return {
        answer: 'I need both a bullish and bearish Detection Engine event before I can compare them. Broaden the chain, severity, or event type.',
        tool: 'compare_detection_events',
        data: { events },
        actions: [{ label: 'Open Detection Engine', href: '/detection', kind: 'navigate' }]
      };
    }

    const stronger = bullish.score >= bearish.score ? bullish : bearish;
    return {
      answer: [
        `Comparison: ${eventTokenLabel(bullish)} versus ${eventTokenLabel(bearish)}.`,
        `${detectionEventLine(bullish)}`,
        `${detectionEventLine(bearish)}`,
        `${eventTokenLabel(stronger)} has the stronger score at ${Math.round(stronger.score)}. Treat that as the higher-priority watch unless liquidity or net flow changes on the next scan.`,
        `${eventTokenLabel(bullish)} read: ${detectionMeaning(bullish)}`,
        `${eventTokenLabel(bearish)} read: ${detectionMeaning(bearish)}`
      ].join('\n'),
      tool: 'compare_detection_events',
      data: { events: [bullish, bearish] },
      actions: this.buildDetectionActions(stronger)
    };
  }

  private async resolveSafeScanReport(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null) {
    const query = request.address || request.query || pageContext?.subjectAddress || '';
    const chain = request.chain || pageContext?.subjectChain || '';
    const token = query ? await resolveToken(query, chain, pageContext?.pairAddress).catch(() => null) : null;
    const pair = token?.pair as any;
    const address = request.address || pair?.baseToken?.address || query;
    if (!address || !EVM_ADDRESS_REGEX.test(address) && !SOLANA_ADDRESS_REGEX.test(address)) {
      return { error: 'I need a valid token contract or mint address before I can read Safe Scan data.' };
    }
    const network = toBubblemapsChain(pair?.chainId || chain, address);
    const report = await this.safeScanService.buildReport(network, address);
    return { report, network, address, token };
  }

  private safeScanActions(address: string, chain: BubblemapsChain): AiAssistantAction[] {
    return [{ label: 'Open Safe Scan', href: `/safe-scan?${new URLSearchParams({ address, chain, autoScan: '1' }).toString()}`, kind: 'navigate' }];
  }

  private async answerSafeScanBrief(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    const resolved = await this.resolveSafeScanReport(request, pageContext);
    if ('error' in resolved) {
      return {
        answer: resolved.error || 'I need a valid token contract or mint address before I can read Safe Scan data.',
        tool: 'safe_scan_needs_address',
        actions: [{ label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }]
      };
    }

    const facts = safeScanFacts(resolved.report);
    const supply = facts.supply;
    const answer = [
      `Safe Scan read for ${facts.label} on ${facts.chain}.`,
      `Bubblemaps score: ${facts.score === null ? 'unavailable' : facts.score}. Gini: ${facts.gini ?? 'unavailable'}. HHI: ${facts.hhi ?? 'unavailable'}. Nakamoto: ${facts.nakamoto ?? 'unavailable'}.`,
      `Largest holder: ${facts.largestHolder ? `${compactAddress(holderAddress(facts.largestHolder))} at ${formatScanPercent(holderPercent(facts.largestHolder))}` : 'unavailable'}. Largest cluster: ${facts.largestCluster ? `${formatScanPercent(clusterPercent(facts.largestCluster))} across ${facts.largestCluster.holder_count} linked holders` : 'unavailable'}.`,
      supply ? `Supply exposure: CEX ${formatScanPercent(supply.cexs)}, DEX ${formatScanPercent(supply.dexs)}, contracts ${formatScanPercent(supply.contracts)}, fresh wallets ${formatScanPercent(supply.fresh_wallets)}, bundles ${formatScanPercent(supply.bundles)}, top 10 adjusted ${formatScanPercent(supply.top_10_adjusted)}.` : 'Supply exposure is unavailable.',
      safeScanRiskRead(facts)
    ].join('\n');

    return {
      answer,
      tool: request.tool === 'run_safe_scan' ? 'run_safe_scan' : 'get_safe_scan_brief',
      data: {
        token: {
          name: facts.tokenName,
          symbol: facts.tokenSymbol,
          chain: facts.chain,
          address: facts.address,
          indexed: facts.indexed,
          transfers: facts.transfers
        },
        scores: {
          bubblemapsScore: facts.score,
          gini: facts.gini,
          hhi: facts.hhi,
          nakamoto: facts.nakamoto
        },
        supplyExposure: facts.supply,
        largestHolder: facts.largestHolder,
        largestCluster: facts.largestCluster,
        endpointStatus: facts.endpointStatus
      },
      actions: this.safeScanActions(resolved.address, resolved.network)
    };
  }

  private async answerSafeScanHolders(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    const resolved = await this.resolveSafeScanReport(request, pageContext);
    if ('error' in resolved) {
      return { answer: resolved.error || 'I need a valid token contract or mint address before I can read Safe Scan data.', tool: 'safe_scan_needs_address', actions: [{ label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }] };
    }

    const facts = safeScanFacts(resolved.report);
    const holders = facts.holders.slice(0, request.responseStyle === 'detailed' ? 10 : 5);
    const rows = holders.map((holder, index) => {
      const details = holder.address_details;
      const flags = [
        details?.label,
        details?.is_cex ? 'CEX' : '',
        details?.is_dex ? 'DEX' : '',
        details?.is_contract ? 'Contract' : ''
      ].filter(Boolean).join(', ');
      return `${index + 1}. ${compactAddress(holderAddress(holder))}: ${formatScanPercent(holderPercent(holder))}, ${formatTokenAmount(holderAmount(holder))} tokens${flags ? `, ${flags}` : ''}.`;
    });

    return {
      answer: [
        `${facts.label} has ${facts.holders.length} holder rows from Bubblemaps.`,
        rows.length ? rows.join('\n') : 'Holder details are unavailable for this token.',
        facts.largestHolder ? `Largest holder read: ${compactAddress(holderAddress(facts.largestHolder))} controls ${formatScanPercent(holderPercent(facts.largestHolder))}.` : '',
        facts.supply ? `Adjusted top 10 holder share: ${formatScanPercent(facts.supply.top_10_adjusted)}.` : ''
      ].filter(Boolean).join('\n'),
      tool: 'get_safe_scan_holders',
      data: { holders: facts.holders.slice(0, 25), supplyExposure: facts.supply, endpointStatus: facts.endpointStatus },
      actions: this.safeScanActions(resolved.address, resolved.network)
    };
  }

  private async answerSafeScanClusters(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    const resolved = await this.resolveSafeScanReport(request, pageContext);
    if ('error' in resolved) {
      return { answer: resolved.error || 'I need a valid token contract or mint address before I can read Safe Scan data.', tool: 'safe_scan_needs_address', actions: [{ label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }] };
    }

    const facts = safeScanFacts(resolved.report);
    const clusters = facts.clusters.slice(0, request.responseStyle === 'detailed' ? 8 : 5);
    const rows = clusters.map((cluster, index) =>
      `${index + 1}. Cluster ${index + 1}: ${formatScanPercent(clusterPercent(cluster))}, ${formatTokenAmount(cluster.amount)} tokens, ${cluster.holder_count} linked holders.`
    );

    return {
      answer: [
        `${facts.label} has ${facts.clusters.length} linked holder cluster${facts.clusters.length === 1 ? '' : 's'} from Bubblemaps.`,
        rows.length ? rows.join('\n') : 'Cluster details are unavailable for this token.',
        facts.largestCluster ? `Largest cluster implication: ${formatScanPercent(clusterPercent(facts.largestCluster))} of supply sits in one linked group.` : '',
        safeScanRiskRead(facts)
      ].filter(Boolean).join('\n'),
      tool: 'get_safe_scan_clusters',
      data: { clusters: facts.clusters.slice(0, 25), endpointStatus: facts.endpointStatus },
      actions: this.safeScanActions(resolved.address, resolved.network)
    };
  }

  private async answerSafeScanMetric(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    const metricName = request.metricName || request.query || 'Safe Scan';
    const resolved = await this.resolveSafeScanReport(request, pageContext);
    if ('error' in resolved) {
      return {
        answer: safeScanMetricExplanation(metricName),
        tool: 'explain_safe_scan_metric'
      };
    }

    const facts = safeScanFacts(resolved.report);
    return {
      answer: [
        safeScanMetricExplanation(metricName),
        `Current ${facts.label} values: score ${facts.score ?? 'unavailable'}, Gini ${facts.gini ?? 'unavailable'}, HHI ${facts.hhi ?? 'unavailable'}, Nakamoto ${facts.nakamoto ?? 'unavailable'}, largest holder ${facts.largestHolder ? formatScanPercent(holderPercent(facts.largestHolder)) : 'unavailable'}, largest cluster ${facts.largestCluster ? formatScanPercent(clusterPercent(facts.largestCluster)) : 'unavailable'}.`,
        safeScanRiskRead(facts)
      ].join('\n'),
      tool: 'explain_safe_scan_metric',
      data: {
        metricName,
        scores: {
          bubblemapsScore: facts.score,
          gini: facts.gini,
          hhi: facts.hhi,
          nakamoto: facts.nakamoto
        },
        largestHolder: facts.largestHolder,
        largestCluster: facts.largestCluster
      },
      actions: this.safeScanActions(resolved.address, resolved.network)
    };
  }

  private async answerTokenProfile(request: AiAssistantToolRequest, pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    const profile = await this.resolveTokenProfile(request, pageContext);
    const pair = profile.pair as any;
    const latestEvent = profile.detectionEvents[0];
    const label = pair ? tokenLabel(pair) : latestEvent ? eventTokenLabel(latestEvent) : request.query || request.address || 'that token';
    const chain = pair?.chainId || latestEvent?.token.chain || request.chain || 'unknown chain';

    if (!pair && !latestEvent) {
      return {
        answer: 'I could not find that token in Atlaix data yet. Try the ticker, full token name, or contract address.',
        tool: 'token_not_found',
        actions: [{ label: 'Open Overview', href: '/dashboard', kind: 'navigate' }]
      };
    }

    const priceLine = pair
      ? `${label} is trading at ${formatUsd(pair.priceUsd)} on ${chain}. 24h move: ${pair.priceChange?.h24 ?? 'unavailable'}%. Volume: ${formatUsd(pair.volume?.h24)}. Liquidity: ${formatUsd(pair.liquidity?.usd)}. Market cap: ${formatUsd(pair.marketCap || pair.fdv)}.`
      : `${label} is showing in Detection Engine on ${chain}. Price is not available from the current overview feed, so I am using Detection metrics.`;
    const detectionLine = latestEvent
      ? `Latest Detection Engine read: ${latestEvent.eventType}, ${latestEvent.severity} severity, score ${Math.round(latestEvent.score)}, liquidity ${formatUsd(latestEvent.metrics.liquidity)}, net flow ${formatSignedUsd(latestEvent.metrics.netFlow)}, ${formatAge(latestEvent.detectedAt)}.`
      : 'Detection Engine has no recent event for this token in the current scope.';
    const eventSummary = latestEvent ? `${detectionMeaning(latestEvent)}\n${detectionNextCheck(latestEvent)}` : '';

    const params = new URLSearchParams();
    if (pair?.chainId || chain) params.set('chain', pair?.chainId || chain);
    if (pair?.pairAddress) params.set('pair', pair.pairAddress);
    const address = pair?.baseToken?.address || profile.address || request.query || '';
    const actions: AiAssistantAction[] = [];
    if (address) actions.push({ label: 'Open Token Details', href: `/token/${encodeURIComponent(address)}?${params.toString()}`, kind: 'navigate' });
    if (latestEvent) actions.push(...this.buildDetectionActions(latestEvent));

    return {
      answer: [priceLine, detectionLine, eventSummary].filter(Boolean).join('\n'),
      tool: 'get_token_profile',
      data: profile,
      actions
    };
  }

  private async buildResponse(message: string, history: AiAssistantConversationMessage[], pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    if (!getProvider().configured) {
      return { answer: toolCallingUnavailable(), tool: 'configuration_required' };
    }

    const modelSelection: { request?: AiAssistantToolRequest; answer?: string } = await chooseToolWithModel(message, history, pageContext).catch(() => ({}));
    if (modelSelection.answer && !modelSelection.request) {
      return { answer: modelSelection.answer, tool: 'conversation' };
    }

    if (!modelSelection.request) {
      return { answer: 'I could not choose a safe Atlaix tool for that request. Rephrase it with the token, wallet, chain, or Detection Engine action you want.', tool: 'tool_selection_failed' };
    }

    const request = sanitizeToolRequest(modelSelection.request);
    const query = request.query || request.address || pageContext?.subjectAddress || '';
    const chain = request.chain || pageContext?.subjectChain || '';

    if (request.tool === 'conversation') {
      if (getProvider().configured) {
        const answer = await callOpenRouter(
          [
            'You are Atlaix AI, a helpful assistant inside the Atlaix crypto intelligence platform.',
            'Be clear and conversational. If data is needed, ask for the token, wallet, or chain.',
            ASSISTANT_VOICE_RULES,
            pageContext?.systemContext || ''
          ].join('\n'),
          [
            ...history.slice(-8).map((item) => ({ role: item.role, content: item.text }) as { role: 'user' | 'assistant'; content: string }),
            { role: 'user', content: message }
          ],
          15_000
        ).catch(() => '');
        return { answer: answer || fallbackConversation(pageContext), tool: 'conversation' };
      }
      return { answer: fallbackConversation(pageContext), tool: 'conversation' };
    }

    if (request.tool === 'get_detection_events') {
      return this.answerDetectionEvents(request);
    }

    if (request.tool === 'get_detection_summary') {
      return this.answerDetectionSummary(request);
    }

    if (request.tool === 'get_detection_token_recent_events') {
      return this.answerDetectionTokenRecentEvents(request);
    }

    if (request.tool === 'get_detection_token_history') {
      return this.answerDetectionTokenHistory(request);
    }

    if (request.tool === 'get_detection_event_detail') {
      return this.answerDetectionEventDetail(request);
    }

    if (request.tool === 'explain_detection_event_type') {
      return this.answerDetectionEventType(request);
    }

    if (request.tool === 'compare_detection_events') {
      return this.answerDetectionComparison(request);
    }

    if (request.tool === 'get_token_profile') {
      return this.answerTokenProfile(request, pageContext);
    }

    if (request.tool === 'run_safe_scan' || request.tool === 'get_safe_scan_brief') {
      return this.answerSafeScanBrief(request, pageContext);
    }

    if (request.tool === 'get_safe_scan_holders') {
      return this.answerSafeScanHolders(request, pageContext);
    }

    if (request.tool === 'get_safe_scan_clusters') {
      return this.answerSafeScanClusters(request, pageContext);
    }

    if (request.tool === 'explain_safe_scan_metric') {
      return this.answerSafeScanMetric(request, pageContext);
    }

    if (request.tool === 'get_platform_updates') {
      const feed = await getOverviewFeed(false).catch(() => ({ tokens: [] as any[] }));
      const tokens = Array.isArray((feed as any).tokens) ? (feed as any).tokens.slice(0, 5).map((token: any) => ({
        chain: token.chain,
        name: token.name,
        symbol: token.symbol || token.ticker,
        address: token.address,
        pairAddress: token.pairAddress,
        priceUsd: token.priceUsd || token.price,
        change24h: token.change24h || token.h24,
        marketCapUsd: token.marketCapUsd || token.marketCap,
        volume24hUsd: token.volume24hUsd || token.volume24h,
        liquidityUsd: token.liquidityUsd || token.liquidity,
        dexBuys24h: token.dexBuys24h,
        dexSells24h: token.dexSells24h,
        dexFlowUsd24h: token.dexFlowUsd24h
      })) : [];
      const lines = tokens.map((token: any, index: number) =>
        `${index + 1}. ${token.symbol || token.name || 'Token'} on ${token.chain || 'unknown'}: price ${token.priceUsd || 'unavailable'}, 24h ${token.change24h || 'unavailable'}, liquidity ${token.liquidityUsd || 'unavailable'}.`
      );
      return {
        answer: lines.length ? `Current Atlaix market read:\n${lines.join('\n')}` : 'I could not load a fresh market feed yet. Try again after the overview feed refreshes.',
        tool: 'get_platform_updates',
        data: { tokens }
      };
    }

    if (request.tool === 'get_smart_alert_status') {
      const status = this.smartAlerts.runner.getStatus();
      return {
        answer: status.lastError
          ? `Smart Alerts last run needs attention: ${status.lastError}`
          : `Smart Alerts are available. Last run status: ${status.lastRunStatus || 'pending'}. Rules checked: ${status.rulesChecked || 0}.`,
        tool: 'get_smart_alert_status',
        data: status,
        actions: [{ label: 'Open Smart Alerts', href: '/smart-alerts', kind: 'navigate' }]
      };
    }

    if (request.tool === 'prepare_alert_setup') {
      const token = query ? await resolveToken(query, chain, pageContext?.pairAddress).catch(() => null) : null;
      const pair = token?.pair as any;
      const address = request.address || pair?.baseToken?.address || query;
      const params = new URLSearchParams();
      if (address) params.set('address', address);
      if (pair?.chainId || chain) params.set('chain', pair?.chainId || chain);
      params.set('source', 'assistant');
      return {
        answer: address
          ? `I prepared a Smart Alert setup for ${pair ? tokenLabel(pair) : compactAddress(address)}. Review the rule before saving it.`
          : 'I can prepare the Smart Alert setup, but I need a token contract address, ticker, or token name first.',
        tool: address ? 'alert_setup' : 'alert_setup_needs_token',
        data: { token },
        actions: [{ label: 'Open Smart Alerts', href: `/smart-alerts?${params.toString()}`, kind: 'draft', confirmationRequired: true }]
      };
    }

    if (request.tool === 'open_token_details') {
      const token = await resolveToken(query, chain, pageContext?.pairAddress).catch(() => null);
      const pair = token?.pair as any;
      const address = pair?.baseToken?.address || request.address || query;
      const params = new URLSearchParams();
      if (pair?.chainId || chain) params.set('chain', pair?.chainId || chain);
      if (pair?.pairAddress) params.set('pair', pair.pairAddress);
      return {
        answer: address ? `Open ${pair ? tokenLabel(pair) : compactAddress(address)} in Token Details.` : 'I need a token address or name before I can open Token Details.',
        tool: 'open_token_details',
        data: { token },
        actions: address ? [{ label: 'Open Token Details', href: `/token/${encodeURIComponent(address)}?${params.toString()}`, kind: 'navigate' }] : []
      };
    }

    if (request.tool === 'get_token_overview' || request.tool === 'get_token_deep_brief') {
      const token = await resolveToken(query, chain, pageContext?.pairAddress);
      const pair = token?.pair as any;
      if (!pair) {
        return {
          answer: 'I could not find that token in the current Atlaix market data. Try a contract address or a more specific ticker.',
          tool: 'token_not_found',
          actions: [{ label: 'Open Overview', href: '/dashboard', kind: 'navigate' }]
        };
      }
      const label = tokenLabel(pair);
      const answer = [
        `${label} is trading at ${formatUsd(pair.priceUsd)} on ${pair.chainId || chain || 'unknown chain'}.`,
        `24h move: ${pair.priceChange?.h24 ?? 'unavailable'}%. Volume: ${formatUsd(pair.volume?.h24)}. Liquidity: ${formatUsd(pair.liquidity?.usd)}. Market cap: ${formatUsd(pair.marketCap || pair.fdv)}.`,
        request.tool === 'get_token_deep_brief' ? `Pools found: ${token?.pairs?.length || 1}. Use Safe Scan or Smart Alerts if you want risk checks or threshold monitoring.` : ''
      ].filter(Boolean).join('\n');
      const params = new URLSearchParams();
      if (pair.chainId) params.set('chain', pair.chainId);
      if (pair.pairAddress) params.set('pair', pair.pairAddress);
      return {
        answer,
        tool: request.tool,
        data: token,
        actions: [
          { label: 'Open Token Details', href: `/token/${encodeURIComponent(pair.baseToken?.address || query)}?${params.toString()}`, kind: 'navigate' },
          { label: 'Run Safe Scan', href: `/safe-scan?${new URLSearchParams({ address: pair.baseToken?.address || query, chain: toBubblemapsChain(pair.chainId || chain, pair.baseToken?.address || query), autoScan: '1' }).toString()}`, kind: 'draft', confirmationRequired: true },
          { label: 'Create Smart Alert', href: `/smart-alerts?${new URLSearchParams({ address: pair.baseToken?.address || query, chain: pair.chainId || chain, source: 'assistant' }).toString()}`, kind: 'draft', confirmationRequired: true }
        ]
      };
    }

    if (request.tool === 'get_wallet_deep_brief') {
      const address = request.address || query;
      if (!address || !EVM_ADDRESS_REGEX.test(address) && !SOLANA_ADDRESS_REGEX.test(address)) {
        return {
          answer: 'I need a valid wallet address before I can build a wallet brief.',
          tool: 'wallet_needs_address',
          actions: [{ label: 'Open Wallet Intelligence', href: '/wallet', kind: 'navigate' }]
        };
      }
      const portfolio = await this.walletService.getPortfolio(address, chain as never || 'All Chains' as never, 'ALL');
      const assets = (portfolio as any).assets || [];
      const topAssets = assets.slice(0, 5).map((asset: any, index: number) =>
        `${index + 1}. ${asset.symbol || asset.name}: ${asset.balance || 'N/A'} worth ${asset.value || 'N/A'}${asset.pnl ? `, PnL ${asset.pnl}` : ''}.`
      );
      return {
        answer: [
          `Wallet ${compactAddress(address)} has ${(portfolio as any).activePositions || assets.length || 0} visible positions and net worth ${(portfolio as any).netWorth || 'N/A'}.`,
          topAssets.length ? `Top holdings:\n${topAssets.join('\n')}` : 'No token holdings were returned for the selected chain.'
        ].join('\n'),
        tool: 'get_wallet_deep_brief',
        data: portfolio,
        actions: [{ label: 'Open Wallet Intelligence', href: `/wallet/${encodeURIComponent(address)}?${new URLSearchParams({ chain: chain || 'All Chains' }).toString()}`, kind: 'navigate' }]
      };
    }

    return { answer: fallbackConversation(pageContext), tool: 'conversation' };
  }
}
