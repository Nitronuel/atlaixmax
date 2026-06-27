import { apiUrl } from '../../config';
import type { DetectionEventsResponse, DetectionTokenAiAssessmentResponse, DetectionTokenDetailResponse, DetectionTokenRecentEventsResponse } from '../../shared/detection';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  if (!payload) throw new Error('Detection Engine returned an invalid response.');
  return payload as T;
}

export const DetectionService = {
  getEvents() {
    return fetchJson<DetectionEventsResponse>('/api/detection/events?limit=500');
  },

  runNow() {
    return fetchJson('/api/detection/run', { method: 'POST' });
  },

  getToken(chain: string, address: string, pair = '') {
    const params = new URLSearchParams({ chain, address });
    if (pair) params.set('pair', pair);
    return fetchJson<DetectionTokenDetailResponse>(`/api/detection/token?${params.toString()}`);
  },

  getTokenRecentEvents(chain: string, address: string, pair = '') {
    const params = new URLSearchParams({ chain, address });
    if (pair) params.set('pair', pair);
    return fetchJson<DetectionTokenRecentEventsResponse>(`/api/detection/token/recent-events?${params.toString()}`);
  },

  getTokenAiAssessment(chain: string, address: string, pair = '') {
    const params = new URLSearchParams({ chain, address });
    if (pair) params.set('pair', pair);
    return fetchJson<DetectionTokenAiAssessmentResponse>(`/api/detection/token/ai-assessment?${params.toString()}`);
  }
};
