import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendNotFound } from '../http/response';
import { DetectionRunner } from './runner';
import { DetectionStore, type DetectionEventFilters } from './store';

type CachedResponse = {
  expiresAt: number;
  body: unknown;
};

const EVENTS_CACHE_TTL_MS = 30_000;
const TOKEN_DETAIL_CACHE_TTL_MS = 60_000;
const MAX_RESPONSE_CACHE_ENTRIES = 500;

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class DetectionRoutes {
  readonly store = new DetectionStore();
  readonly runner = new DetectionRunner(this.store);
  private readonly responseCache = new Map<string, CachedResponse>();

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
