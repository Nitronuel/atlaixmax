import { readEnv } from '../env';
import { TtlCache } from './cache';
import type { EndpointResult, InsightXNetwork } from '../../src/shared/insightx';
import type { z } from 'zod';

export type InsightXEndpointKey =
  | 'scanner'
  | 'overview'
  | 'clusters'
  | 'snipers'
  | 'bundlers'
  | 'insiders'
  | 'atlasLatest'
  | 'atlasTimestamps'
  | 'labels';

type FetchOptions = {
  path: string;
  cacheKey: string;
  endpointKey: InsightXEndpointKey;
  network: InsightXNetwork;
  params?: Record<string, string | number | null | undefined>;
  schema?: z.ZodType;
  ttlMs?: number;
};

const INSIGHTX_BASE_URL = 'https://api.insightx.network';
const INSIGHTX_TIMEOUT_MS = 18_000;
const INSIGHTX_RATE_LIMIT_RETRIES = 2;
const INSIGHTX_RATE_LIMIT_BACKOFF_MS = 900;
const INSIGHTX_REQUEST_SPACING_MS = 1_500;
export const INSIGHTX_DEFAULT_CACHE_TTL_MS = 3 * 60_000;
export const INSIGHTX_LABEL_CACHE_TTL_MS = 24 * 60 * 60_000;
let insightXRequestQueue = Promise.resolve();

const endpointNetworks: Record<InsightXEndpointKey, Set<InsightXNetwork>> = {
  scanner: new Set(['sol', 'eth', 'base', 'bsc']),
  overview: new Set(['sol', 'eth', 'base', 'bsc']),
  clusters: new Set(['sol', 'eth', 'base', 'bsc', 'monad', 'xlayer', 'abs']),
  snipers: new Set(['sol']),
  bundlers: new Set(['sol']),
  insiders: new Set(['sol']),
  atlasLatest: new Set(['sol', 'eth', 'base', 'bsc', 'monad', 'xlayer', 'abs']),
  atlasTimestamps: new Set(['sol', 'eth', 'base', 'bsc', 'monad', 'xlayer', 'abs']),
  labels: new Set(['sol', 'eth', 'base', 'bsc', 'monad', 'xlayer', 'abs'])
};

function getApiKey() {
  return readEnv('INSIGHTX_API_KEY');
}

function getBaseUrl() {
  return readEnv('INSIGHTX_API_BASE_URL') || INSIGHTX_BASE_URL;
}

function statusFromHttp(status: number) {
  if (status === 404) return 'missing';
  if (status === 429) return 'rate_limited';
  if (status === 422 || status === 501) return 'unsupported';
  return 'error';
}

async function fetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(retryAfter: string | null, attempt: number) {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 5_000);
  return INSIGHTX_RATE_LIMIT_BACKOFF_MS * attempt;
}

async function queuedFetchWithTimeout(url: URL, init: RequestInit, timeoutMs: number) {
  const request = insightXRequestQueue.then(async () => {
    await sleep(INSIGHTX_REQUEST_SPACING_MS);
    return fetchWithTimeout(url, init, timeoutMs);
  });
  insightXRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

export class InsightXClient {
  constructor(private readonly cache = new TtlCache()) {}

  get cacheSize() {
    return this.cache.size;
  }

  get configured() {
    return Boolean(getApiKey());
  }

  get baseUrl() {
    return getBaseUrl();
  }

  async fetchEndpoint<T>(options: FetchOptions): Promise<EndpointResult<T>> {
    const fetchedAt = new Date().toISOString();
    if (!endpointNetworks[options.endpointKey].has(options.network)) {
      return {
        status: 'unsupported',
        data: null,
        error: `${options.endpointKey} is not supported on ${options.network}.`,
        fetchedAt
      };
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        status: 'not_configured',
        data: null,
        error: 'InsightX API key is not configured.',
        fetchedAt
      };
    }

    const cached = this.cache.get(options.cacheKey);
    if (cached) {
      return {
        status: 'available',
        data: cached.value as T,
        cached: true,
        cachedAt: cached.cachedAt,
        fetchedAt
      };
    }

    const url = new URL(options.path, getBaseUrl());
    for (const [key, value] of Object.entries(options.params || {})) {
      if (value !== null && value !== undefined && String(value).trim()) {
        url.searchParams.set(key, String(value));
      }
    }

    for (let attempt = 1; attempt <= INSIGHTX_RATE_LIMIT_RETRIES + 1; attempt += 1) {
      try {
        const response = await queuedFetchWithTimeout(url, {
          headers: {
            Accept: 'application/json',
            'X-API-Key': apiKey
          }
        }, INSIGHTX_TIMEOUT_MS);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const retryAfter = response.headers.get('Retry-After');
        if (response.status === 429 && attempt <= INSIGHTX_RATE_LIMIT_RETRIES) {
          await sleep(retryDelayMs(retryAfter, attempt));
          continue;
        }
        const detail = typeof payload?.detail === 'string'
          ? payload.detail
          : Array.isArray(payload?.detail)
            ? payload.detail.map((item: { msg?: string; type?: string }) => item.msg || item.type).filter(Boolean).join(', ')
            : payload?.error || `InsightX request failed with status ${response.status}.`;

        return {
          status: statusFromHttp(response.status),
          data: null,
          error: detail,
          httpStatus: response.status,
          retryAfter,
          fetchedAt
        };
      }

      const parsedPayload = options.schema ? options.schema.parse(payload) : payload;
      this.cache.set(options.cacheKey, parsedPayload, options.ttlMs ?? INSIGHTX_DEFAULT_CACHE_TTL_MS, fetchedAt);
      return {
        status: 'available',
        data: parsedPayload as T,
        cached: false,
        fetchedAt
      };
      } catch (error) {
        if (error && typeof error === 'object' && 'issues' in error) {
          return {
            status: 'error',
            data: null,
            error: 'InsightX returned an unexpected response shape.',
            fetchedAt
          };
        }
        if (attempt <= INSIGHTX_RATE_LIMIT_RETRIES) {
          await sleep(INSIGHTX_RATE_LIMIT_BACKOFF_MS * attempt);
          continue;
        }
        return {
          status: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'InsightX request failed.',
          fetchedAt
        };
      }
    }

    return {
      status: 'error',
      data: null,
      error: 'InsightX request failed.',
      fetchedAt
    };
  }
}
