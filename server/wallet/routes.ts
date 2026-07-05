import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { readEnv } from '../env';
import { sendJson, sendNotFound } from '../http/response';
import { WalletPortfolioService } from './service';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUPPORTED_PERIODS = new Set(['ALL', '1D', '1W', '1M', '>1M']);
const SUPPORTED_CHAINS = new Set(['All Chains', 'Ethereum', 'Solana', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche']);
const SUPPORTED_ACTIVITY_KINDS = new Set(['all', 'buy', 'sell', 'swap', 'receive', 'send', 'approval', 'contract', 'unknown', 'large']);
const walletPortfolioService = new WalletPortfolioService();
const WALLET_AI_INSIGHT_TTL_MS = 10 * 60_000;
const MAX_WALLET_AI_CACHE_ENTRIES = 250;

type WalletAiInsightCacheEntry = {
  expiresAt: number;
  body: WalletAiInsightResponse;
};

type WalletAiInsightResponse = {
  insight: string;
  confidence: 'low' | 'medium' | 'high';
  generatedAt: string;
  source: 'model' | 'fallback' | 'cache';
};

function isValidWallet(address: string) {
  return EVM_ADDRESS_REGEX.test(address) || (!address.startsWith('0x') && SOLANA_ADDRESS_REGEX.test(address));
}

async function readJsonBody(request: IncomingMessage, maxBytes = 80_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 18_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeInsight(value: unknown) {
  const cleaned = String(value || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[*_`#]/g, '')
    .trim();
  const firstSentence = cleaned.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || cleaned;
  const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, 24);
  return words.join(' ').replace(/[,:;]$/, '.');
}

function parseModelInsight(value: string, fallbackInsight: string): WalletAiInsightResponse | null {
  const cleaned = value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return null;
  }

  const insight = sanitizeInsight(raw.insight);
  if (!insight || insight.length < 24 || insight === fallbackInsight) return null;

  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
    ? raw.confidence
    : 'medium';
  return {
    insight,
    confidence,
    generatedAt: new Date().toISOString(),
    source: 'model'
  };
}

async function generateWalletAiInsight(packet: unknown, fallbackInsight: string) {
  const apiKey = readEnv('OPENROUTER_API_KEY');
  const model = readEnv('OPENROUTER_MODEL');
  if (!apiKey || !model) return null;

  const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Atlaix Wallet AI Insight'
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      messages: [
        {
          role: 'system',
          content: [
            'You write one short Wallet Insight sentence for Atlaix Wallet Intelligence.',
            'Use only the supplied wallet intelligence packet.',
            'Do not invent facts. If data is incomplete, mention uncertainty briefly.',
            'Return valid JSON only with insight and confidence.',
            'Insight must be one sentence under 24 words.',
            'Focus on behavior, risk, PnL, activity, and asset preference.',
            'No markdown, no investment advice, no predictions, no "should buy" or "should sell".'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({ wallet: packet, fallbackShape: { insight: fallbackInsight, confidence: 'low' } })
        }
      ]
    })
  });

  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return parseModelInsight(String(payload?.choices?.[0]?.message?.content || ''), fallbackInsight);
}

export class WalletRoutes {
  private readonly aiInsightCache = new Map<string, WalletAiInsightCacheEntry>();

  private setAiInsightCache(key: string, body: WalletAiInsightResponse) {
    if (this.aiInsightCache.size >= MAX_WALLET_AI_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [cachedKey, cached] of this.aiInsightCache) {
        if (cached.expiresAt <= now) this.aiInsightCache.delete(cachedKey);
      }
      if (this.aiInsightCache.size >= MAX_WALLET_AI_CACHE_ENTRIES) {
        const firstKey = this.aiInsightCache.keys().next().value;
        if (firstKey) this.aiInsightCache.delete(firstKey);
      }
    }
    this.aiInsightCache.set(key, { expiresAt: Date.now() + WALLET_AI_INSIGHT_TTL_MS, body });
  }

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    if (
      requestUrl.pathname !== '/api/wallet/portfolio'
      && requestUrl.pathname !== '/api/wallet/portfolio-fast'
      && requestUrl.pathname !== '/api/wallet/performance'
      && requestUrl.pathname !== '/api/wallet/intelligence'
      && requestUrl.pathname !== '/api/wallet/activity'
      && requestUrl.pathname !== '/api/wallet/ai-insight'
    ) {
      sendNotFound(response);
      return;
    }

    if (requestUrl.pathname === '/api/wallet/ai-insight') {
      if (method !== 'POST') {
        sendNotFound(response);
        return;
      }

      const body = await readJsonBody(request);
      const address = String(body.address || '').trim();
      const chain = String(body.chain || 'All Chains').trim();
      const fingerprint = String(body.fingerprint || '').trim();
      const packet = body.packet && typeof body.packet === 'object' ? body.packet : {};
      const fallbackInsight = sanitizeInsight(body.fallbackInsight) || 'Wallet data is ready, but activity is limited for a reliable read.';

      if (!isValidWallet(address)) {
        sendJson(response, 400, { error: 'Enter a valid EVM or Solana wallet address.' });
        return;
      }

      if (!SUPPORTED_CHAINS.has(chain)) {
        sendJson(response, 400, { error: 'Unsupported wallet chain.' });
        return;
      }

      const packetHash = createHash('sha256').update(JSON.stringify(packet)).digest('hex').slice(0, 24);
      const cacheKey = `${address.toLowerCase()}:${chain}:${fingerprint || packetHash}`;
      const cached = this.aiInsightCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        sendJson(response, 200, { ...cached.body, source: 'cache' });
        return;
      }

      const modelInsight = await generateWalletAiInsight(packet, fallbackInsight).catch(() => null);
      const result: WalletAiInsightResponse = modelInsight || {
        insight: fallbackInsight,
        confidence: 'low',
        generatedAt: new Date().toISOString(),
        source: 'fallback'
      };
      this.setAiInsightCache(cacheKey, result);
      sendJson(response, 200, result);
      return;
    }

    const address = requestUrl.searchParams.get('address')?.trim() || '';
    const chain = requestUrl.searchParams.get('chain')?.trim() || 'All Chains';
    const period = requestUrl.searchParams.get('period')?.trim() || 'ALL';
    const force = requestUrl.searchParams.get('force') === 'true';

    if (!isValidWallet(address)) {
      sendJson(response, 400, { error: 'Enter a valid EVM or Solana wallet address.' });
      return;
    }

    if (!SUPPORTED_CHAINS.has(chain)) {
      sendJson(response, 400, { error: 'Unsupported wallet chain.' });
      return;
    }

    if (!SUPPORTED_PERIODS.has(period)) {
      sendJson(response, 400, { error: 'Unsupported wallet period.' });
      return;
    }

    if (requestUrl.pathname === '/api/wallet/activity') {
      const kind = requestUrl.searchParams.get('kind')?.trim() || 'all';
      const limit = Math.max(10, Math.min(Number(requestUrl.searchParams.get('limit')) || 500, 500));

      if (!SUPPORTED_ACTIVITY_KINDS.has(kind)) {
        sendJson(response, 400, { error: 'Unsupported wallet activity filter.' });
        return;
      }

      const activity = await walletPortfolioService.getActivity(address, chain as never, { period, kind, limit });
      sendJson(response, 200, activity);
      return;
    }

    if (requestUrl.pathname === '/api/wallet/intelligence') {
      const intelligence = await walletPortfolioService.getIntelligence(address, chain as never, period, force);
      sendJson(response, 200, intelligence);
      return;
    }

    const portfolio = await walletPortfolioService.getPortfolio(address, chain as never, period, force);
    sendJson(response, 200, portfolio);
  }
}
