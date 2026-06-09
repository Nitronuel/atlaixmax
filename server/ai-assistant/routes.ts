import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readEnv } from '../env';
import { sendJson, sendNotFound } from '../http/response';
import { InsightXClient } from '../insightx/client';
import { InsightXReportService } from '../insightx/report-service';
import { getOverviewFeed, getOverviewTokenDetails, searchOverviewTokens } from '../overview/database';
import type { SmartAlertRoutes } from '../smart-alerts/routes';
import { WalletPortfolioService } from '../wallet/service';

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
  | 'heatmap'
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
  | 'get_wallet_deep_brief'
  | 'get_platform_updates'
  | 'run_safe_scan'
  | 'prepare_alert_setup'
  | 'get_smart_alert_status'
  | 'open_token_details';

type AiAssistantToolRequest = {
  tool: AiAssistantToolName;
  address?: string;
  chain?: string;
  query?: string;
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
  solana: 'sol',
  sol: 'sol'
};

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
  return {
    configured: Boolean(readEnv('OPENROUTER_API_KEY') && model),
    model,
    mode: model && readEnv('OPENROUTER_API_KEY') ? 'model-ready' : 'local-tool-router'
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

function toInsightXNetwork(chain = '', address = '') {
  const normalized = normalizeChain(chain);
  if (NETWORK_BY_CHAIN[normalized]) return NETWORK_BY_CHAIN[normalized];
  return SOLANA_ADDRESS_REGEX.test(address) && !address.startsWith('0x') ? 'sol' : 'eth';
}

function inferChain(message: string, address = '') {
  const lower = message.toLowerCase();
  if (lower.includes('base')) return 'base';
  if (lower.includes('solana') || lower.includes(' sol ')) return 'solana';
  if (lower.includes('bsc') || lower.includes('bnb')) return 'bsc';
  if (lower.includes('ethereum') || lower.includes(' eth ')) return 'ethereum';
  if (address && !address.startsWith('0x') && SOLANA_ADDRESS_REGEX.test(address)) return 'solana';
  return '';
}

function extractAddress(message: string) {
  return message.match(EVM_ADDRESS_REGEX)?.[0] || message.match(SOLANA_ADDRESS_REGEX)?.[0] || '';
}

function cleanTokenQuery(value: string) {
  return String(value || '')
    .replace(EVM_ADDRESS_REGEX, '')
    .replace(SOLANA_ADDRESS_REGEX, '')
    .replace(/\b(price|market cap|mcap|liquidity|volume|overview|details|token|coin|called|named|search|find|lookup|moving|performing|today|worth|of|the|a|an|is|how|what|about)\b/gi, ' ')
    .replace(/[?$#:,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTokenQuery(message: string, history: AiAssistantConversationMessage[] = []) {
  const address = extractAddress(message);
  if (address) return address;
  const cashtag = message.match(/\$([a-zA-Z][a-zA-Z0-9]{1,15})\b/)?.[1];
  if (cashtag) return cashtag;
  const quoted = message.match(/["']([^"']{2,40})["']/)?.[1];
  if (quoted) return cleanTokenQuery(quoted);
  const cleaned = cleanTokenQuery(message);
  if (cleaned && cleaned.length <= 32) return cleaned;
  for (const item of history.slice().reverse()) {
    const prior = extractAddress(item.text) || item.text.match(/\$([a-zA-Z][a-zA-Z0-9]{1,15})\b/)?.[1] || '';
    if (prior) return prior;
  }
  return '';
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

function chooseTool(message: string, history: AiAssistantConversationMessage[], pageContext?: AiAssistantPageContext | null): AiAssistantToolRequest {
  const lower = message.toLowerCase();
  const address = extractAddress(message) || (/\b(this|that|it)\b/.test(lower) ? pageContext?.subjectAddress || '' : '');
  const query = extractTokenQuery(message, history) || pageContext?.subjectAddress || '';
  const chain = inferChain(message, address) || pageContext?.subjectChain || '';

  if (/\b(alert status|smart alert status|runner|trigger history)\b/.test(lower)) {
    return { tool: 'get_smart_alert_status' };
  }

  if (/\b(alert|notify|watch|monitor)\b/.test(lower)) {
    return { tool: 'prepare_alert_setup', address, query, chain };
  }

  if (/\b(wallet|holder|holdings|portfolio|pnl|time held|tracked wallet)\b/.test(lower) || pageContext?.module === 'wallet' && /\b(this|that|it|analyze|explain)\b/.test(lower)) {
    return { tool: 'get_wallet_deep_brief', address, query, chain };
  }

  if (/\b(scan|safe|risk|security|rug|honeypot|forensic|scam)\b/.test(lower)) {
    return { tool: 'run_safe_scan', address, query, chain, responseStyle: 'detailed' };
  }

  if (/\b(open|go to|show)\b/.test(lower) && /\b(token details|token page|details page)\b/.test(lower)) {
    return { tool: 'open_token_details', address, query, chain };
  }

  if (address || /\$[a-zA-Z]/.test(message) || /\b(price|market cap|mcap|liquidity|volume|overview|details|performing|moving|token|coin)\b/.test(lower) || pageContext?.module === 'token') {
    return {
      tool: /\b(price|market cap|mcap|overview|details)\b/.test(lower) ? 'get_token_overview' : 'get_token_deep_brief',
      address,
      query,
      chain,
      responseStyle: /\b(deep|everything|full|analysis|analyze)\b/.test(lower) ? 'detailed' : 'brief'
    };
  }

  if (/\b(update|today|market|platform|what should i pay attention|trending)\b/.test(lower)) {
    return { tool: 'get_platform_updates', responseStyle: 'brief' };
  }

  return { tool: 'conversation' };
}

function parseNumber(value: unknown) {
  const raw = String(value ?? '').replace(/[$,%+,]/g, '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUsd(value: unknown) {
  const numeric = typeof value === 'number' ? value : parseNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'unavailable';
  if (numeric >= 1e9) return `$${(numeric / 1e9).toFixed(2)}B`;
  if (numeric >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  if (numeric >= 1e3) return `$${(numeric / 1e3).toFixed(2)}K`;
  return `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 6 })}`;
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

function fallbackConversation(pageContext?: AiAssistantPageContext | null) {
  const title = pageContext?.title || 'Atlaix';
  return [
    `I am ready on ${title}.`,
    'Ask me about token performance, wallet holdings, Safe Scan risk, Smart Alerts, or current market activity and I will route it into the right Atlaix workflow.'
  ].join('\n');
}

async function synthesize(message: string, history: AiAssistantConversationMessage[], pageContext: AiAssistantPageContext | null, result: AiAssistantToolResult) {
  if (!getProvider().configured || result.tool === 'conversation') return result;
  try {
    const content = await callOpenRouter(
      [
        'You are Atlaix AI inside a crypto intelligence app.',
        'Answer using only the supplied Atlaix data. Do not invent prices, holder data, endpoints, or trading advice.',
        'Keep the answer concise, direct, and useful. Use plain text with no markdown tables and no emoji.',
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
    return content ? { ...result, answer: content } : result;
  } catch {
    return result;
  }
}

export class AiAssistantRoutes {
  private readonly walletService = new WalletPortfolioService();
  private readonly safeScanService = new InsightXReportService(new InsightXClient());

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
        ...result
      });
      return;
    }

    sendNotFound(response);
  }

  private async buildResponse(message: string, history: AiAssistantConversationMessage[], pageContext: AiAssistantPageContext | null): Promise<AiAssistantToolResult> {
    const request = chooseTool(message, history, pageContext);
    const query = request.query || request.address || pageContext?.subjectAddress || '';
    const chain = request.chain || pageContext?.subjectChain || '';

    if (request.tool === 'conversation') {
      if (getProvider().configured) {
        const answer = await callOpenRouter(
          [
            'You are Atlaix AI, a helpful assistant inside the Atlaix crypto intelligence platform.',
            'Be clear and conversational. If data is needed, ask for the token, wallet, or chain.',
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

    if (request.tool === 'get_platform_updates') {
      const feed = await getOverviewFeed(false).catch(() => ({ tokens: [] as any[] }));
      const tokens = Array.isArray((feed as any).tokens) ? (feed as any).tokens.slice(0, 5) : [];
      const lines = tokens.map((token: any, index: number) =>
        `${index + 1}. ${token.ticker || token.symbol || token.name || 'Token'} on ${token.chain || 'unknown'}: price ${token.price || 'unavailable'}, 24h ${token.h24 || token.change24h || 'unavailable'}, liquidity ${token.liquidity || 'unavailable'}.`
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
          { label: 'Run Safe Scan', href: `/safe-scan?${new URLSearchParams({ address: pair.baseToken?.address || query, chain: toInsightXNetwork(pair.chainId || chain), autoScan: '1' }).toString()}`, kind: 'draft', confirmationRequired: true },
          { label: 'Create Smart Alert', href: `/smart-alerts?${new URLSearchParams({ address: pair.baseToken?.address || query, chain: pair.chainId || chain, source: 'assistant' }).toString()}`, kind: 'draft', confirmationRequired: true }
        ]
      };
    }

    if (request.tool === 'run_safe_scan') {
      const token = query ? await resolveToken(query, chain, pageContext?.pairAddress).catch(() => null) : null;
      const pair = token?.pair as any;
      const address = request.address || pair?.baseToken?.address || query;
      if (!address || !EVM_ADDRESS_REGEX.test(address) && !SOLANA_ADDRESS_REGEX.test(address)) {
        return {
          answer: 'I can run a Safe Scan, but I need a valid token contract or mint address first.',
          tool: 'safe_scan_needs_address',
          actions: [{ label: 'Open Safe Scan', href: '/safe-scan', kind: 'navigate' }]
        };
      }
      const network = toInsightXNetwork(pair?.chainId || chain, address) as never;
      const report = await this.safeScanService.buildReport(network, address);
      const intelligence = (report as any).bundleIntelligence || {};
      const holder = (report as any).holderConcentration || {};
      return {
        answer: [
          `Safe Scan completed for ${(report as any).tokenSymbol || (report as any).tokenName || compactAddress(address)}.`,
          `Risk level: ${intelligence.riskLevel || 'unknown'} with ${intelligence.confidence || 'unknown'} confidence.`,
          `Top 10 holder concentration: ${Number(holder.top10Pct || 0).toFixed(2)}%.`
        ].join('\n'),
        tool: 'run_safe_scan',
        data: report,
        actions: [{ label: 'Open Safe Scan', href: `/safe-scan?${new URLSearchParams({ address, chain: network, autoScan: '1' }).toString()}`, kind: 'navigate' }]
      };
    }

    if (request.tool === 'get_wallet_deep_brief') {
      const address = request.address || query;
      if (!address || !EVM_ADDRESS_REGEX.test(address) && !SOLANA_ADDRESS_REGEX.test(address)) {
        return {
          answer: 'I need a valid wallet address before I can build a wallet brief.',
          tool: 'wallet_needs_address',
          actions: [{ label: 'Open Wallet Tracker', href: '/wallet', kind: 'navigate' }]
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
        actions: [{ label: 'Open Wallet Tracker', href: `/wallet/${encodeURIComponent(address)}?${new URLSearchParams({ chain: chain || 'All Chains' }).toString()}`, kind: 'navigate' }]
      };
    }

    return { answer: fallbackConversation(pageContext), tool: 'conversation' };
  }
}
