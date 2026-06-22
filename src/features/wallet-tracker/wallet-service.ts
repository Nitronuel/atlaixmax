import { apiUrl } from '../../config';
import type { WalletActivity, WalletActivityFilter, WalletChain, WalletPortfolio, WalletTimeFilter } from './wallet-types';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; data: WalletPortfolio }>();
const activityCache = new Map<string, { expiresAt: number; data: WalletActivity }>();

function fallbackPortfolio(message: string): WalletPortfolio {
  return {
    netWorth: '$0.00',
    assets: [],
    providerStatus: 'provider_missing',
    message,
    generatedAt: new Date().toISOString()
  };
}

export const WalletPortfolioService = {
  async getPortfolio(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, signal?: AbortSignal, force = false) {
    const key = `${chain}:${address.toLowerCase()}:${timeFilter}`;
    const cached = cache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

    return fetch(apiUrl(`/api/wallet/portfolio?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}&period=${timeFilter}`), { signal })
      .then(async (response) => {
        if (response.status === 404) {
          return fallbackPortfolio('Wallet holdings are not available yet.');
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Wallet portfolio is unavailable.');
        }
        return response.json() as Promise<WalletPortfolio>;
      })
      .then((data) => {
        cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      });
  },

  async getPortfolioFast(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, signal?: AbortSignal, force = false) {
    const key = `fast:${chain}:${address.toLowerCase()}:${timeFilter}`;
    const cached = cache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

    return fetch(apiUrl(`/api/wallet/portfolio-fast?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}&period=${timeFilter}`), { signal })
      .then(async (response) => {
        if (response.status === 404) {
          return fallbackPortfolio('Wallet holdings are not available yet.');
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Wallet portfolio is unavailable.');
        }
        return response.json() as Promise<WalletPortfolio>;
      })
      .then((data) => {
        cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      });
  },

  async getPerformance(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, signal?: AbortSignal, force = false) {
    const key = `performance:${chain}:${address.toLowerCase()}:${timeFilter}`;
    const cached = cache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

    return fetch(apiUrl(`/api/wallet/performance?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}&period=${timeFilter}`), { signal })
      .then(async (response) => {
        if (response.status === 404) {
          return fallbackPortfolio('Wallet performance is not available yet.');
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Wallet performance is unavailable.');
        }
        return response.json() as Promise<WalletPortfolio>;
      })
      .then((data) => {
        cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      });
  },

  async getActivity(address: string, chain: WalletChain, timeFilter: WalletTimeFilter, kind: WalletActivityFilter, signal?: AbortSignal, force = false) {
    const key = `activity:${chain}:${address.toLowerCase()}:${timeFilter}:${kind}`;
    const cached = activityCache.get(key);
    if (!force && cached && cached.expiresAt > Date.now()) return cached.data;

    const params = new URLSearchParams({
      address,
      chain,
      period: timeFilter,
      kind,
      limit: '250'
    });

    return fetch(apiUrl(`/api/wallet/activity?${params.toString()}`), { signal })
      .then(async (response) => {
        if (response.status === 404) {
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
            message: 'Wallet activity is not available yet.',
            generatedAt: new Date().toISOString()
          } satisfies WalletActivity;
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Wallet activity is unavailable.');
        }
        return response.json() as Promise<WalletActivity>;
      })
      .then((data) => {
        activityCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
        return data;
      });
  }
};
