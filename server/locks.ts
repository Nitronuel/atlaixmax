import { randomUUID } from 'node:crypto';
import { readEnv } from './env';

const LOCK_OWNER = `${process.pid}:${randomUUID()}`;

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

async function callLockRpc<T>(name: string, body: Record<string, string | number>) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for system locks.');

  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase lock RPC ${name} failed (${response.status}). ${message}`.trim());
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function acquireSystemLock(name: string, ttlSeconds: number) {
  const acquired = await callLockRpc<boolean>('try_acquire_system_lock', {
    lock_name: name,
    lock_owner: LOCK_OWNER,
    ttl_seconds: ttlSeconds
  });
  return acquired === true;
}

export async function releaseSystemLock(name: string) {
  await callLockRpc<boolean>('release_system_lock', {
    lock_name: name,
    lock_owner: LOCK_OWNER
  });
}
