import type { z } from 'zod';
import { readEnv } from '../env';
import { TtlCache } from '../shared/cache';
import type { EndpointResult } from '../../src/shared/bubblemaps';

type FetchOptions = {
  path: string;
  cacheKey: string;
  endpointKey: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  schema?: z.ZodType;
  ttlMs?: number;
};

const BUBBLEMAPS_BASE_URL = 'https://api.bubblemaps.io';
const BUBBLEMAPS_TIMEOUT_MS = 18_000;
const BUBBLEMAPS_RATE_LIMIT_RETRIES = 2;
const BUBBLEMAPS_RATE_LIMIT_BACKOFF_MS = 900;
export const BUBBLEMAPS_DEFAULT_CACHE_TTL_MS = 3 * 60_000;
export const BUBBLEMAPS_CHAIN_CACHE_TTL_MS = 24 * 60 * 60_000;

function getApiKey() {
  return readEnv('BUBBLEMAPS_API_KEY');
}

function getBaseUrl() {
  return readEnv('BUBBLEMAPS_API_BASE_URL') || BUBBLEMAPS_BASE_URL;
}

function statusFromHttp(status: number) {
  if (status === 404) return 'missing';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422 || status === 501) return 'unsupported';
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
  return BUBBLEMAPS_RATE_LIMIT_BACKOFF_MS * attempt;
}

export class BubblemapsClient {
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
    const apiKey = getApiKey();
    if (!apiKey) {
      return {
        status: 'not_configured',
        data: null,
        error: 'Bubblemaps API key is not configured.',
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

    for (let attempt = 1; attempt <= BUBBLEMAPS_RATE_LIMIT_RETRIES + 1; attempt += 1) {
      try {
        const response = await fetchWithTimeout(url, {
          headers: {
            Accept: 'application/json',
            'X-ApiKey': apiKey
          }
        }, BUBBLEMAPS_TIMEOUT_MS);
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          const retryAfter = response.headers.get('Retry-After');
          if (response.status === 429 && attempt <= BUBBLEMAPS_RATE_LIMIT_RETRIES) {
            await sleep(retryDelayMs(retryAfter, attempt));
            continue;
          }
          const detail = typeof payload?.detail === 'string'
            ? payload.detail
            : Array.isArray(payload?.detail)
              ? payload.detail.map((item: { msg?: string; type?: string }) => item.msg || item.type).filter(Boolean).join(', ')
              : payload?.error || `Bubblemaps request failed with status ${response.status}.`;

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
        this.cache.set(options.cacheKey, parsedPayload, options.ttlMs ?? BUBBLEMAPS_DEFAULT_CACHE_TTL_MS, fetchedAt);
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
            error: 'Bubblemaps returned an unexpected response shape.',
            fetchedAt
          };
        }
        if (attempt <= BUBBLEMAPS_RATE_LIMIT_RETRIES) {
          await sleep(BUBBLEMAPS_RATE_LIMIT_BACKOFF_MS * attempt);
          continue;
        }
        return {
          status: 'error',
          data: null,
          error: error instanceof Error ? error.message : 'Bubblemaps request failed.',
          fetchedAt
        };
      }
    }

    return {
      status: 'error',
      data: null,
      error: 'Bubblemaps request failed.',
      fetchedAt
    };
  }
}
