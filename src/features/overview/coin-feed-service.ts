import { apiUrl } from '../../config';
import type { CoinGeckoChartResponse, CoinGeckoCoin, CoinGeckoCoinDetailsResponse, CoinGeckoFeedResponse } from '../../shared/coingecko';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  if (!payload) throw new Error('Coin feed returned an invalid response.');
  return payload as T;
}

function assertCoinFeed(payload: CoinGeckoFeedResponse): CoinGeckoFeedResponse {
  if (!Array.isArray(payload.coins) || typeof payload.generatedAt !== 'string') {
    throw new Error('Coin feed returned an invalid response.');
  }
  return payload;
}

export const CoinFeedService = {
  getFeed(force = false) {
    return fetchJson<CoinGeckoFeedResponse>(`/api/coingecko/feed${force ? '?force=1' : ''}`).then(assertCoinFeed);
  },

  async search(query: string): Promise<CoinGeckoCoin[]> {
    if (!query.trim()) return [];
    const params = new URLSearchParams({ q: query.trim() });
    const response = assertCoinFeed(await fetchJson<CoinGeckoFeedResponse>(`/api/coingecko/search?${params.toString()}`));
    return response.coins;
  },

  getCoin(id: string) {
    const params = new URLSearchParams({ id });
    return fetchJson<CoinGeckoCoinDetailsResponse>(`/api/coingecko/coin?${params.toString()}`);
  },

  getChart(id: string, days = 7) {
    const params = new URLSearchParams({ id, days: String(days) });
    return fetchJson<CoinGeckoChartResponse>(`/api/coingecko/chart?${params.toString()}`);
  }
};
