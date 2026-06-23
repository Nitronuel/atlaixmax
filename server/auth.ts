import type { IncomingMessage } from 'node:http';
import { readEnv } from './env';

export type AuthenticatedUser = {
  id: string;
  email: string;
};

const SUPABASE_AUTH_TIMEOUT_MS = 10_000;

function getSupabasePublicConfig() {
  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = readEnv('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  return { url, anonKey };
}

function getBearerToken(request: IncomingMessage) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] || '' : header);
  return match?.[1]?.trim() || '';
}

export async function requireAuthenticatedUser(request: IncomingMessage): Promise<AuthenticatedUser> {
  const token = getBearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');

  const { url, anonKey } = getSupabasePublicConfig();
  if (!url || !anonKey) throw new Error('AUTH_NOT_CONFIGURED');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_AUTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      signal: controller.signal,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) throw new Error('AUTH_REQUIRED');
    const payload = await response.json().catch(() => null);
    const id = typeof payload?.id === 'string' ? payload.id : '';
    if (!id) throw new Error('AUTH_REQUIRED');

    return {
      id,
      email: typeof payload?.email === 'string' ? payload.email : ''
    };
  } finally {
    clearTimeout(timeout);
  }
}
