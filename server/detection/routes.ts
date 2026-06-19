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
  DetectionTokenRecentEventsResponse,
  DetectionTokenStructuredAssessment
} from '../../src/shared/detection';

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

function formatCompactUsd(value: number) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '$0';
  const sign = numeric < 0 ? '-' : '';
  const absolute = Math.abs(numeric);
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

function formatSignedNumber(value: number) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';
  return `${numeric > 0 ? '+' : ''}${numeric.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0%';
  return `${numeric > 0 ? '+' : ''}${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}%`;
}

function compactEvent(event: DetectionEvent, index: number) {
  return {
    index: index + 1,
    eventType: event.eventType,
    sentiment: event.sentiment,
    severity: event.severity,
    detectedAt: event.detectedAt,
    age: formatEventAge(event.detectedAt),
    summary: event.summary,
    metrics: {
      volume24h: event.metrics.volume24h,
      liquidity: event.metrics.liquidity,
      priceChange24h: event.metrics.priceChange24h,
      netFlow: event.metrics.netFlow
    },
    formattedMetrics: {
      volume24h: formatCompactUsd(event.metrics.volume24h),
      liquidity: formatCompactUsd(event.metrics.liquidity),
      priceChange24h: formatPercent(event.metrics.priceChange24h),
      netFlow: formatSignedNumber(event.metrics.netFlow)
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

function severityTone(event?: DetectionEvent) {
  if (!event) return 'developing';
  if (event.severity === 'critical') return 'acute';
  if (event.severity === 'high') return 'meaningful';
  if (event.severity === 'medium') return 'notable';
  return 'early-stage';
}

function stateFor(latest: DetectionEvent | undefined, relationship: DetectionEventRelationship): string {
  if (!latest) return 'High Uncertainty';
  const label = latest.eventType.toLowerCase();
  if (relationship === 'mixed_unstable') return 'High Uncertainty';
  if (relationship === 'sequential_recovery') return 'Recovery';
  if (relationship === 'sequential_deterioration') return latest.sentiment === 'bearish' ? 'Structural Weakness' : 'Trend Exhaustion';
  if (label.includes('liquidity drain') || label.includes('low-liquidity')) return 'Liquidity Stress';
  if (label.includes('liquidity added')) return 'Expansion';
  if (label.includes('accumulation') || label.includes('buy recovery')) return relationship === 'conflicting' ? 'Recovery' : 'Accumulation';
  if (label.includes('distribution') || label.includes('sell') || label.includes('dump')) return 'Distribution';
  if (label.includes('breakout') || label.includes('breakdown')) return 'Volatility Expansion';
  if (label.includes('continuation')) return 'Trend Continuation';
  if (latest.sentiment === 'bullish') return 'Structural Strength';
  if (latest.sentiment === 'bearish') return 'Structural Weakness';
  return 'High Uncertainty';
}

function marketBiasFor(latest: DetectionEvent | undefined, relationship: DetectionEventRelationship, bias: DetectionRelationshipBias): string {
  if (!latest) return 'Unavailable';
  const unconfirmed = relationship === 'conflicting' || relationship === 'mixed_unstable' || relationship === 'single_event' || latest.severity === 'low';
  if (latest.sentiment === 'bullish') return unconfirmed ? 'Bullish / Unconfirmed' : 'Bullish';
  if (latest.sentiment === 'bearish') return unconfirmed ? 'Bearish / Unconfirmed' : 'Bearish';
  if (bias === 'bullish') return 'Bullish / Unconfirmed';
  if (bias === 'bearish') return 'Bearish / Unconfirmed';
  return 'Unclear';
}

function contraryCaseFor(event?: DetectionEvent, relationship?: DetectionEventRelationship) {
  if (!event) return 'clearer confirmation from volume, liquidity, and price structure';
  const label = event.eventType.toLowerCase();
  if (label.includes('bullish continuation')) return 'support loss, fading buy-side flow, or liquidity leaving the pool';
  if (label.includes('bearish continuation')) return 'buyers reclaiming key levels, selling pressure fading, or liquidity improving';
  if (label.includes('short-term bounce')) return 'sellers reasserting control at resistance or liquidity fading';
  if (label.includes('pullback')) return 'support breakdown, expanding sell-side flow, or liquidity deterioration';
  if (label.includes('bullish reversal')) return 'failure to hold above resistance or renewed sell-side dominance';
  if (label.includes('bearish breakdown')) return 'support reclaim with stronger buy-side absorption';
  if (label.includes('range breakout')) return 'price falling back into range with fading buy-side flow';
  if (label.includes('range breakdown')) return 'price recovering back into range with stronger buy-side flow';
  if (label.includes('low-liquidity price spike')) return 'quick retrace, liquidity failing to deepen, or volume fading';
  if (label.includes('low-liquidity sell')) return 'liquidity returning and buyers stabilizing price';
  if (label.includes('liquidity drain')) return 'liquidity returning, order depth stabilizing, or buyers absorbing pressure';
  if (label.includes('liquidity added')) return 'new liquidity leaving quickly, activity fading, or sell-side flow taking control';
  if (label === 'pump') return 'liquidity failing to support the move or swift retracement';
  if (label === 'dump') return 'renewed buy-side absorption and price stabilization';
  if (label.includes('buy recovery')) return 'buy-side flow fading or sellers regaining control';
  if (label.includes('sell-off')) return 'buyers absorbing selling and stabilizing price';
  if (label.includes('accumulation')) return 'buy-side flow fading, liquidity thinning, or sellers regaining control';
  if (label.includes('distribution')) return 'buy demand absorbing supply, price reclaiming range, or sell-side flow fading';
  if (event.sentiment === 'bullish') return 'fading buy-side flow, support loss, or liquidity leaving the pool';
  if (event.sentiment === 'bearish') return 'buyers absorbing pressure, liquidity improving, or price reclaiming structure';
  return 'cleaner confirmation from volume, liquidity, and price structure';
}

export function classifyEventRelationship(events: DetectionEvent[]): DetectionTokenAssessmentContext {
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

  const bias = relationship === 'mixed_unstable' ? 'mixed' : relationshipBias(recent);
  const state = stateFor(latest, relationship);
  return {
    relationship,
    bias,
    state,
    marketBias: marketBiasFor(latest, relationship, bias),
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

function sequenceLabel(events: DetectionEvent[]) {
  const count = Math.max(1, Math.min(5, events.length));
  return `${count}-event sequence`;
}

function supportingSignalsFor(events: DetectionEvent[], context: DetectionTokenAssessmentContext) {
  const latest = events[0];
  const signals = new Set<string>();
  if (!latest) return [];
  signals.add(`${latest.eventType} detected`);
  if (context.relationship === 'aligned') signals.add('Recent events point in the same direction');
  if (context.relationship === 'conflicting') signals.add('Latest event changed the prior read');
  if (context.relationship === 'sequential_recovery') signals.add('Recent sequence shows recovery pressure');
  if (context.relationship === 'sequential_deterioration') signals.add('Recent sequence shows weakening structure');
  if (latest.metrics.priceChange24h) signals.add(`${formatPercent(latest.metrics.priceChange24h)} 24h price change`);
  if (latest.metrics.netFlow) signals.add(`${formatSignedNumber(latest.metrics.netFlow)} net flow`);
  if (latest.metrics.liquidity) signals.add(`${formatCompactUsd(latest.metrics.liquidity)} liquidity depth`);
  if (latest?.severity === 'high' || latest?.severity === 'critical') signals.add(`${severityTone(latest)} event intensity`);
  return [...signals].slice(0, 3);
}

function watchForFor(events: DetectionEvent[], context: DetectionTokenAssessmentContext) {
  const latest = events[0];
  const label = latest?.eventType.toLowerCase() || '';
  if (context.relationship === 'mixed_unstable' && latest?.sentiment === 'bullish') return ['Liquidity leaving the pool', 'Fading buy-side flow', 'Support loss'];
  if (context.relationship === 'mixed_unstable' && latest?.sentiment === 'bearish') return ['Buy-side absorption', 'Liquidity recovery', 'Price structure reclaim'];
  if (context.relationship === 'mixed_unstable') return ['Cleaner direction from flow', 'Liquidity confirmation', 'Range reclaim or failure'];
  if (label.includes('liquidity drain')) return ['Liquidity recovery', 'Order depth stabilization', 'Buy-side absorption'];
  if (label.includes('liquidity added')) return ['Liquidity staying in the pool', 'Organic volume follow-through', 'Sell-side pressure returning'];
  if (latest?.sentiment === 'bullish') return ['Liquidity leaving the pool', 'Fading buy-side flow', 'Support loss'];
  if (latest?.sentiment === 'bearish') return ['Buy-side absorption', 'Liquidity recovery', 'Price structure reclaim'];
  return ['Volume confirmation', 'Liquidity changes', 'Price structure'];
}

export function localAssessment(tokenName: string, events: DetectionEvent[], context: DetectionTokenAssessmentContext): DetectionTokenStructuredAssessment {
  const latest = events[0];
  if (!latest) {
    return {
      state: 'High Uncertainty',
      sequenceLabel: 'No recent events',
      summary: 'No recent Detection Engine events are available for this token yet.',
      marketBias: 'Unavailable',
      invalidation: 'Fresh Detection Engine events are needed before forming a market read.',
      supportingSignals: [],
      watchFor: ['New detection events', 'Liquidity changes', 'Flow changes']
    };
  }
  const prior = events.filter((event) => context.relevantPriorEventIds.includes(event.id));
  const intensity = severityTone(latest);
  const priorLine = prior.length
    ? `Recent context includes ${prior.map((event) => event.eventType.toLowerCase()).join(' and ')}, giving this a ${context.relationship.replaceAll('_', ' ')} profile.`
    : `This is a ${context.relationship.replaceAll('_', ' ')} read.`;
  return {
    state: context.state,
    sequenceLabel: sequenceLabel(events),
    summary: `${tokenName}'s latest event is ${latest.eventType}, an ${intensity} ${latest.sentiment} read. ${priorLine} Confirmation depends on liquidity, flow, and whether price structure supports the current event.`,
    marketBias: context.marketBias,
    invalidation: context.contraryCase,
    supportingSignals: supportingSignalsFor(events, context),
    watchFor: watchForFor(events, context)
  };
}

function normalizeAssessmentText(value: string) {
  return value
    .replace(/(^|[^\w])\*\*([^*\n]+?)\*\*/g, '$1$2')
    .replace(/(^|[^\w])\*([^*\n]+?)\*/g, '$1$2')
    .replace(/\*{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeAssessmentString(value: unknown, maxLength: number) {
  const normalized = normalizeAssessmentText(String(value || ''));
  const cleaned = normalized
    .replace(/\bscore\s*\d+(\.\d+)?\b/gi, '')
    .replace(/\b\d+(\.\d+)?\s*%\s*(chance|confidence|probability)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  const clipped = cleaned.slice(0, maxLength + 1);
  return clipped.slice(0, Math.max(0, clipped.lastIndexOf(' '))).trim();
}

function hasBannedAssessmentLanguage(value: DetectionTokenStructuredAssessment) {
  const haystack = [
    value.state,
    value.sequenceLabel,
    value.summary,
    value.marketBias,
    value.invalidation,
    ...value.supportingSignals,
    ...value.watchFor
  ].join(' ').toLowerCase();
  return /\b(score\s*\d+|buy now|sell now|entry|target|guaranteed|will pump|will dump|will moon|price will|% chance|confidence score|likelihood|likely|probability)\b/.test(haystack);
}

export function parseAssessmentJson(value: string, fallback: DetectionTokenStructuredAssessment): DetectionTokenStructuredAssessment | null {
  const cleaned = value.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  let raw: any;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return null;
  }
  const assessment: DetectionTokenStructuredAssessment = {
    state: sanitizeAssessmentString(raw.state || fallback.state, 48),
    sequenceLabel: sanitizeAssessmentString(raw.sequenceLabel || fallback.sequenceLabel, 32),
    summary: sanitizeAssessmentString(raw.summary || fallback.summary, 560),
    marketBias: fallback.marketBias,
    invalidation: fallback.invalidation,
    supportingSignals: fallback.supportingSignals,
    watchFor: fallback.watchFor
  };
  if (!assessment.summary || !assessment.marketBias || !assessment.invalidation || hasBannedAssessmentLanguage(assessment)) return null;
  return {
    ...assessment,
    supportingSignals: assessment.supportingSignals.length ? assessment.supportingSignals : fallback.supportingSignals,
    watchFor: assessment.watchFor.length ? assessment.watchFor : fallback.watchFor
  };
}

async function modelAssessment(tokenName: string, events: DetectionEvent[], context: DetectionTokenAssessmentContext, fallback: DetectionTokenStructuredAssessment) {
  const apiKey = readEnv('OPENROUTER_API_KEY');
  const model = readEnv('OPENROUTER_MODEL');
  if (!apiKey || !model || !events.length) return null;
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
            'Atlaix interprets current market structure. It does not predict price.',
            'Use only the supplied Detection Engine events.',
            'Return valid JSON only with state, sequenceLabel, summary, marketBias, invalidation, supportingSignals, and watchFor.',
            'Lead with the latest event. Use severity as an intensity dial, not as a displayed score.',
            'Market bias and invalidation are controlled by fallbackShape; keep their meaning unchanged.',
            'Use formattedMetrics when mentioning numbers. Percent values must include %, money values must use compact dollar formatting, and do not put metric values in parentheses.',
            'Do not include raw scores, confidence percentages, price targets, buy/sell instructions, or prediction language.',
            'Do not use words like entry, target, guaranteed, likely, likelihood, probability, will pump, will dump, or price will.',
            'Mention no more than two prior events, and only if they change the interpretation.',
            'Summary must be 45 to 75 words. Market bias must be descriptive, not predictive.',
            'Invalidation must describe what would weaken the current interpretation.',
            'Use concise institutional language. No markdown.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            token: tokenName,
            latestEvent: compactEvent(events[0], 0),
            relevantPriorEvents: events.filter((event) => context.relevantPriorEventIds.includes(event.id)).map(compactEvent),
            recentHistory: events.slice(0, 5).map(compactEvent),
            relationshipContext: context,
            fallbackShape: fallback
          })
        }
      ]
    })
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return parseAssessmentJson(String(payload?.choices?.[0]?.message?.content || ''), fallback);
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
      const fallback = localAssessment(tokenName, recent.events, context);
      const modelResult = await modelAssessment(tokenName, recent.events, context, fallback).catch(() => null);
      const body: DetectionTokenAiAssessmentResponse = {
        ...recent,
        assessment: modelResult || fallback,
        source: modelResult ? 'model' : 'local',
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
