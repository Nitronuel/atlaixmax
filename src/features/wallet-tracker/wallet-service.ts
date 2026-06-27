import { apiUrl } from '../../config';
import type { WalletActivity, WalletActivityFilter, WalletChain, WalletPortfolio, WalletTimeFilter } from './wallet-types';

type WalletIntelligence = {
  portfolio: WalletPortfolio;
  activity: WalletActivity;
};

const CACHE_TTL_MS = 60_000;
const intelligenceCache = new Map<string, { expiresAt: number; data: WalletIntelligence }>();
const pendingRequests = new Map<string, Promise<WalletIntelligence>>();

function fallbackPortfolio(message: string): WalletPortfolio {
  return {
    netWorth: '$0.00',
    assets: [],
    providerStatus: 'provider_missing',
    message,
    generatedAt: new Date().toISOString(),
    tradePerformance: []
  };
}

function fallbackActivity(message: string): WalletActivity {
  return {
    activities: [],
    summary: {
      lastActiveAt: 0,
      recentBuys: 0,
      recentSells: 0,
      largestMoveUsd: 0,
      largestMoveLabel: 'No activity',
      mostTradedToken: 'No token yet',
      netFlowUsd: 0
    },
    tradedTokens: [],
    providerStatus: 'provider_missing',
    message,
    generatedAt: new Date().toISOString()
  };
}

function cacheKey(address: string, chain: WalletChain, timeFilter: WalletTimeFilter) {
  return `${address.toLowerCase()}:${chain}:${timeFilter}`;
}

function filterActivity(activity: WalletActivity, kind: WalletActivityFilter) {
  if (kind === 'all') return activity;
  if (kind === 'large') {
    return {
      ...activity,
      activities: activity.activities.filter((item) => (item.usdValue || 0) >= 10_000)
    };
  }
  return {
    ...activity,
    activities: activity.activities.filter((item) => item.kind === kind)
  };
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | { error?: string; message?: string } | null;
  if (!response.ok) {
    const errorBody = body as { error?: string; message?: string } | null;
    throw new Error(errorBody?.error || errorBody?.message || 'Zerion wallet data is unavailable.');
  }
  return body as T;
}

async function loadIntelligence(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, _signal?: AbortSignal, force = false) {
  const key = cacheKey(address, chain, timeFilter);
  const cached = intelligenceCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

  const pending = pendingRequests.get(key);
  if (!force && pending) return pending;

  const params = new URLSearchParams({
    address,
    chain,
    period: timeFilter
  });
  if (force) params.set('force', 'true');

  const request = fetch(apiUrl(`/api/wallet/intelligence?${params.toString()}`))
    .then((response) => readJson<WalletIntelligence>(response))
    .then((data) => {
      intelligenceCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => {
      pendingRequests.delete(key);
    });

  pendingRequests.set(key, request);
  return request;
}

export const WalletPortfolioService = {
  async getPortfolio(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, signal?: AbortSignal, force = false) {
    return this.getPortfolioFast(address, chain, timeFilter, signal, force);
  },

  async getPortfolioFast(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, signal?: AbortSignal, force = false) {
    return loadIntelligence(address, chain, timeFilter, signal, force)
      .then((data) => data.portfolio)
      .catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return fallbackPortfolio(error instanceof Error ? error.message : 'Zerion wallet data is unavailable.');
      });
  },

  async getPerformance(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, signal?: AbortSignal, force = false) {
    return loadIntelligence(address, chain, timeFilter, signal, force)
      .then((data) => data.portfolio)
      .catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return fallbackPortfolio(error instanceof Error ? error.message : 'Zerion wallet performance is unavailable.');
      });
  },

  async getActivity(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, kind: WalletActivityFilter, signal?: AbortSignal, force = false) {
    return loadIntelligence(address, chain, timeFilter, signal, force)
      .then((data) => filterActivity(data.activity, kind))
      .catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return fallbackActivity(error instanceof Error ? error.message : 'Zerion wallet activity is unavailable.');
      });
  }
};
