import { apiUrl } from '../../config';
import type { OverviewFeedResponse, OverviewToken } from '../../shared/overview';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  if (!payload) {
    throw new Error('Live Market Feed returned an invalid response.');
  }
  return payload as T;
}

function assertOverviewFeed(payload: OverviewFeedResponse): OverviewFeedResponse {
  if (!Array.isArray(payload.tokens) || typeof payload.generatedAt !== 'string') {
    throw new Error('Live Market Feed returned an invalid response.');
  }
  return payload;
}

export const OverviewService = {
  getFeed(force = false) {
    return fetchJson<OverviewFeedResponse>(`/api/overview/feed${force ? '?force=1' : ''}`).then(assertOverviewFeed);
  },

  async search(query: string): Promise<OverviewToken[]> {
    if (!query.trim()) return [];
    const params = new URLSearchParams({ q: query.trim() });
    const response = assertOverviewFeed(await fetchJson<OverviewFeedResponse>(`/api/overview/search?${params.toString()}`));
    return response.tokens;
  }
};
