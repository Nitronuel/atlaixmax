import { apiUrl } from '../../config';
import type { WalletChain, WalletPortfolio, WalletTimeFilter } from './wallet-types';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; data: WalletPortfolio }>();

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
  }
};
