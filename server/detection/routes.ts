import type { IncomingMessage, ServerResponse } from 'node:http';
import { readEnv } from '../env';
import { sendJson, sendNotFound } from '../http/response';
import { DetectionRunner } from './runner';
import { DetectionStore, type DetectionEventFilters } from './store';
import type {
  DetectionEvent,
  DetectionEventRelationship,
  DetectionRelationshipBias,
  DetectionTokenAiAssessmentResponse,
  DetectionTokenAssessmentContext,
  DetectionTokenRecentEventsResponse
} from '../../src/shared/detection';
import { detectionEventAssessmentForLabel } from '../../src/shared/detection-copy';

type CachedResponse = {
  expiresAt: number;
  body: unknown;
};

const EVENTS_CACHE_TTL_MS = 30_000;
const TOKEN_DETAIL_CACHE_TTL_MS = 60_000;
const TOKEN_ASSESSMENT_CACHE_TTL_MS = 30_000;
const MAX_RESPONSE_CACHE_ENTRIES = 500;

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function formatEventAge(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function compactEvent(event: DetectionEvent, index: number) {
  return {
    index: index + 1,
    eventType: event.eventType,
    sentiment: event.sentiment,
    severity: event.severity,
    score: event.score,
    detectedAt: event.detectedAt,
    age: formatEventAge(event.detectedAt),
    summary: event.summary,
    metrics: {
      volume24h: event.metrics.volume24h,
      liquidity: event.metrics.liquidity,
      priceChange24h: event.metrics.priceChange24h,
      netFlow: event.metrics.netFlow
    },
    lifecycleStatus: event.lifecycleStatus || '',
    scoreDelta: event.scoreDelta ?? null
  };
}

function relationshipBias(events: DetectionEvent[]): DetectionRelationshipBias {
  const bullish = events.filter((event) => event.sentiment === 'bullish').length;
  const bearish = events.filter((event) => event.sentiment === 'bearish').length;
  const neutral = events.filter((event) => event.sentiment === 'neutral').length;
  if (bullish > bearish && bullish > neutral) return 'bullish';
  if (bearish > bullish && bearish > neutral) return 'bearish';
  if (neutral > bullish && neutral > bearish) return 'neutral';
  return 'mixed';
}

function contraryCaseFor(event?: DetectionEvent, relationship?: DetectionEventRelationship) {
  if (!event) return 'clearer confirmation from volume, liquidity, and price structure';
  const label = event.eventType.toLowerCase();
  if (relationship === 'mixed_unstable') return 'cleaner confirmation from liquidity, flow, and price structure';
  if (label.includes('liquidity drain')) return 'liquidity recovery and renewed buy-side absorption';
  if (label.includes('distribution') || label.includes('dump') || label.includes('sell') || event.sentiment === 'bearish') {
    return 'buyers reclaiming levels with improving liquidity and buy-side absorption';
  }
  if (label.includes('liquidity added')) return 'added liquidity leaving quickly or failing to support organic demand';
  if (label.includes('accumulation') || label.includes('recovery') || label.includes('breakout') || event.sentiment === 'bullish') {
    return 'fading buy-side flow, support loss, or renewed sell-side dominance';
  }
  return 'cleaner confirmation from volume, liquidity, and price structure';
}

function classifyEventRelationship(events: DetectionEvent[]): DetectionTokenAssessmentContext {
  const recent = events.slice(0, 5);
  const latest = recent[0];
  const prior = recent.slice(1);
  const bullishCount = recent.filter((event) => event.sentiment === 'bullish').length;
  const bearishCount = recent.filter((event) => event.sentiment === 'bearish').length;
  const neutralCount = recent.filter((event) => event.sentiment === 'neutral').length;
  const sentimentFlips = recent.slice(1).reduce((count, event, index) => (
    event.sentiment !== recent[index].sentiment ? count + 1 : count
  ), 0);
  const minutesSincePrevious = latest && prior[0] ? Math.max(0, Math.round((latest.detectedAt - prior[0].detectedAt) / 60_000)) : null;

  let relationship: DetectionEventRelationship = 'single_event';
  if (latest && prior.length) {
    const previous = prior[0];
    const priorBullish = prior.filter((event) => event.sentiment === 'bullish').length;
    const priorBearish = prior.filter((event) => event.sentiment === 'bearish').length;
    if (sentimentFlips >= 3 || (bullishCount >= 2 && bearishCount >= 2)) {
      relationship = 'mixed_unstable';
    } else if (latest.sentiment === 'bullish' && priorBearish >= 2) {
      relationship = 'sequential_recovery';
    } else if (latest.sentiment === 'bearish' && priorBullish >= 2) {
      relationship = 'sequential_deterioration';
    } else if (latest.sentiment !== 'neutral' && previous.sentiment !== 'neutral' && latest.sentiment !== previous.sentiment) {
      relationship = 'conflicting';
    } else if (latest.sentiment === previous.sentiment || (latest.sentiment === 'bullish' && priorBullish > priorBearish) || (latest.sentiment === 'bearish' && priorBearish > priorBullish)) {
      relationship = 'aligned';
    } else {
      relationship = 'mixed_unstable';
    }
  }

  const relevantPriorCandidates = [
    prior[0],
    prior.find((event) => latest && event.sentiment !== latest.sentiment),
    prior.find((event) => latest && event.sentiment === latest.sentiment && event.eventType !== latest.eventType)
  ];
  const relevantPriorEvents: DetectionEvent[] = [];
  relevantPriorCandidates.forEach((event) => {
    if (event && !relevantPriorEvents.some((candidate) => candidate.id === event.id)) {
      relevantPriorEvents.push(event);
    }
  });

  return {
    relationship,
    bias: relationship === 'mixed_unstable' ? 'mixed' : relationshipBias(recent),
    contraryCase: contraryCaseFor(latest, relationship),
    relevantPriorEventIds: relevantPriorEvents.map((event) => event.id),
    stats: {
      eventCount: recent.length,
      bullishCount,
      bearishCount,
      neutralCount,
      sentimentFlips,
      minutesSincePrevious
    }
  };
}

function localAssessment(tokenName: string, events: DetectionEvent[], context: DetectionTokenAssessmentContext) {
  const latest = events[0];
  if (!latest) return 'No recent Detection Engine events are available for this token yet.';
  const prior = events.filter((event) => context.relevantPriorEventIds.includes(event.id));
  const priorLine = prior.length ? `Recent context includes ${prior.map((event) => event.eventType).join(' and ').toLowerCase()}, which makes this a ${context.relationship.replaceAll('_', ' ')} read.` : `This is a ${context.relationship.replaceAll('_', ' ')} read.`;
  const latestLine = `${tokenName}'s latest Detection Engine event is ${latest.eventType}, a ${latest.sentiment} read with ${latest.severity} severity.`;
  return `${latestLine} ${priorLine} The contrary case would require ${context.contraryCase}.`;
}

function normalizeAssessmentText(value: string) {
  return value
    .replace(/(^|[^\w])\*\*([^*\n]+?)\*\*/g, '$1$2')
    .replace(/(^|[^\w])\*([^*\n]+?)\*/g, '$1$2')
    .replace(/\*{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function modelAssessment(tokenName: string, events: DetectionEvent[], context: DetectionTokenAssessmentContext) {
  const apiKey = readEnv('OPENROUTER_API_KEY');
  const model = readEnv('OPENROUTER_MODEL');
  if (!apiKey || !model || !events.length) return '';
  const baseUrl = readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1';
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Atlaix Detection AI Assessment'
    },
    body: JSON.stringify({
      model,
      temperature: 0.25,
      messages: [
        {
          role: 'system',
          content: [
            'You write the AI Assessment for one token inside Atlaix Detection Engine.',
            'Use only the supplied Detection Engine events.',
            'Lead with the latest event and its meaning right now.',
            'Use the supplied relationship classification. Name it naturally, such as aligned signals, conflicting shift, sequential deterioration, sequential recovery, mixed unstable, or single-event read.',
            'Mention no more than two prior events, and only if they change the interpretation.',
            'Always include the contrary case in one short clause.',
            'Do not mention index numbers. Do not use markdown. Do not give trading advice. Do not invent data.',
            'Write one concise paragraph between 60 and 80 words.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            token: tokenName,
            latestEvent: compactEvent(events[0], 0),
            relevantPriorEvents: events.filter((event) => context.relevantPriorEventIds.includes(event.id)).map(compactEvent),
            recentHistory: events.slice(0, 5).map(compactEvent),
            relationshipContext: context
          })
        }
      ]
    })
  });
  if (!response.ok) return '';
  const payload = await response.json().catch(() => null);
  return normalizeAssessmentText(String(payload?.choices?.[0]?.message?.content || ''));
}

export class DetectionRoutes {
  readonly store = new DetectionStore();
  readonly runner = new DetectionRunner(this.store);
  private readonly responseCache = new Map<string, CachedResponse>();

  private async getRecentTokenEvents(chain: string, address: string, pair = '', limit = 5): Promise<DetectionTokenRecentEventsResponse> {
    const detail = await this.store.getTokenDetail(chain, address, pair);
    return {
      generatedAt: new Date().toISOString(),
      token: detail.token,
      events: detail.events.slice(0, Math.max(1, Math.min(5, limit)))
    };
  }

  private cacheResponse(key: string, body: unknown, ttlMs: number) {
    if (this.responseCache.size >= MAX_RESPONSE_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [cachedKey, cached] of this.responseCache) {
        if (cached.expiresAt <= now) this.responseCache.delete(cachedKey);
      }
      if (this.responseCache.size >= MAX_RESPONSE_CACHE_ENTRIES) {
        const firstKey = this.responseCache.keys().next().value;
        if (firstKey) this.responseCache.delete(firstKey);
      }
    }
    this.responseCache.set(key, { expiresAt: Date.now() + ttlMs, body });
  }

  start() {
    this.runner.start();
  }

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/detection/events') {
      const cacheKey = requestUrl.href;
      const cached = this.responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        sendJson(response, 200, cached.body);
        return;
      }
      const filters: DetectionEventFilters = {
        q: requestUrl.searchParams.get('q') || undefined,
        chain: requestUrl.searchParams.get('chain') || undefined,
        severity: requestUrl.searchParams.get('severity') as DetectionEventFilters['severity'] || undefined,
        sentiment: requestUrl.searchParams.get('sentiment') as DetectionEventFilters['sentiment'] || undefined,
        limit: parseLimit(requestUrl.searchParams.get('limit'), 100)
      };
      const body = await this.store.listEvents(filters);
      this.cacheResponse(cacheKey, body, EVENTS_CACHE_TTL_MS);
      sendJson(response, 200, body);
      return;
    }

    if (method === 'GET' && pathname === '/api/detection/token') {
      const cacheKey = requestUrl.href;
      const cached = this.responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        sendJson(response, 200, cached.body);
        return;
      }
      const chain = requestUrl.searchParams.get('chain') || '';
      const address = requestUrl.searchParams.get('address') || '';
      const pair = requestUrl.searchParams.get('pair') || '';
      if (!chain.trim() || !address.trim()) {
        sendJson(response, 400, { error: 'Token chain and address are required.' });
        return;
      }
      const body = await this.store.getTokenDetail(chain, address, pair);
      this.cacheResponse(cacheKey, body, TOKEN_DETAIL_CACHE_TTL_MS);
      sendJson(response, 200, body);
      return;
    }

    if (method === 'GET' && pathname === '/api/detection/token/recent-events') {
      const chain = requestUrl.searchParams.get('chain') || '';
      const address = requestUrl.searchParams.get('address') || '';
      const pair = requestUrl.searchParams.get('pair') || '';
      if (!chain.trim() || !address.trim()) {
        sendJson(response, 400, { error: 'Token chain and address are required.' });
        return;
      }
      sendJson(response, 200, await this.getRecentTokenEvents(chain, address, pair, 5));
      return;
    }

    if (method === 'GET' && pathname === '/api/detection/token/ai-assessment') {
      const cacheKey = requestUrl.href;
      const cached = this.responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        sendJson(response, 200, cached.body);
        return;
      }
      const chain = requestUrl.searchParams.get('chain') || '';
      const address = requestUrl.searchParams.get('address') || '';
      const pair = requestUrl.searchParams.get('pair') || '';
      if (!chain.trim() || !address.trim()) {
        sendJson(response, 400, { error: 'Token chain and address are required.' });
        return;
      }
      const recent = await this.getRecentTokenEvents(chain, address, pair, 5);
      const tokenName = recent.token?.tokenSymbol || recent.token?.tokenName || recent.events[0]?.token.ticker || 'This token';
      const context = classifyEventRelationship(recent.events);
      const modelText = await modelAssessment(tokenName, recent.events, context).catch(() => '');
      const body: DetectionTokenAiAssessmentResponse = {
        ...recent,
        assessment: modelText || localAssessment(tokenName, recent.events, context),
        source: modelText ? 'model' : 'local',
        context
      };
      this.cacheResponse(cacheKey, body, TOKEN_ASSESSMENT_CACHE_TTL_MS);
      sendJson(response, 200, body);
      return;
    }

    if (method === 'POST' && pathname === '/api/detection/run') {
      sendJson(response, 200, await this.runner.runNow());
      return;
    }

    if (method === 'GET' && pathname === '/api/detection/status') {
      sendJson(response, 200, this.runner.getStatus());
      return;
    }

    sendNotFound(response);
  }
}
