import { apiUrl } from '../config';
import { authSupabase } from './SupabaseClient';

export interface TelegramStatus {
  connected: boolean;
  botUsername: string;
  telegramUsername: string | null;
  connectedAt: string | null;
}

export interface TelegramLink {
  botUsername: string;
  expiresAt: string;
  url: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = authSupabase ? await authSupabase.auth.getSession() : { data: { session: null } };
  const accessToken = data.session?.access_token;
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'Telegram request failed.');
  }
  return payload as T;
}

export const TelegramService = {
  getStatus: async (): Promise<TelegramStatus> => requestJson<TelegramStatus>('/api/telegram/status'),
  createLink: async (): Promise<TelegramLink> => requestJson<TelegramLink>('/api/telegram/link-token', { method: 'POST' }),
  disconnect: async (): Promise<void> => {
    await requestJson('/api/telegram/disconnect', { method: 'POST' });
  }
};
