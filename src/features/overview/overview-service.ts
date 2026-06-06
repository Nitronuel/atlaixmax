import { apiUrl } from '../../config';
import type { OverviewFeedResponse, OverviewToken } from '../../shared/overview';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { method: 'POST' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export const OverviewService = {
  getFeed(force = false) {
    return fetchJson<OverviewFeedResponse>(`/api/overview/feed${force ? '?force=1' : ''}`);
  },

  ingest(force = false) {
    return postJson<OverviewFeedResponse>(`/api/overview/ingest${force ? '?force=1' : ''}`);
  },

  async search(query: string): Promise<OverviewToken[]> {
    if (!query.trim()) return [];
    const params = new URLSearchParams({ q: query.trim() });
    const response = await fetchJson<OverviewFeedResponse>(`/api/overview/search?${params.toString()}`);
    return response.tokens;
  }
};
