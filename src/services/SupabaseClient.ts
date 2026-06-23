import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

export const hasAuthSupabaseConfig = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);

const authStorageFallback = new Map<string, string>();

const isStorageQuotaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /quota|setitem|storage/i.test(message);
};

const pruneAuthStorage = (incomingAuthKey: string) => {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const preservedKeys = new Set([
    incomingAuthKey,
    'atlaix-theme-preview',
    'atlaix_saved_wallets'
  ]);
  const removablePrefixes = [
    'atlaix-token-activity-cache:',
    'atlaix-safe-scan-report:',
    'atlaix-forensic-report:',
    'atlaix-live-alpha',
    'atlaix-detection',
    'atlaix-global',
    'atlaix-ai-assistant'
  ];

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (!key || preservedKeys.has(key)) continue;
    if (removablePrefixes.some((prefix) => key.startsWith(prefix))) {
      window.localStorage.removeItem(key);
    }
  }
};

const safeAuthStorage = {
  getItem(key: string) {
    if (typeof window === 'undefined') return authStorageFallback.get(key) || null;

    try {
      return window.localStorage.getItem(key) || window.sessionStorage.getItem(key) || authStorageFallback.get(key) || null;
    } catch {
      return authStorageFallback.get(key) || null;
    }
  },
  setItem(key: string, value: string) {
    if (typeof window === 'undefined') {
      authStorageFallback.set(key, value);
      return;
    }

    try {
      window.localStorage.setItem(key, value);
      authStorageFallback.delete(key);
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Session cleanup is best effort.
      }
      return;
    } catch (error) {
      if (!isStorageQuotaError(error)) throw error;
    }

    pruneAuthStorage(key);

    try {
      window.localStorage.setItem(key, value);
      authStorageFallback.delete(key);
      return;
    } catch {
      // Fall through to session or memory storage.
    }

    try {
      window.sessionStorage.setItem(key, value);
      authStorageFallback.delete(key);
    } catch {
      authStorageFallback.set(key, value);
    }
  },
  removeItem(key: string) {
    authStorageFallback.delete(key);
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Local storage may be unavailable.
    }

    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Session storage may be unavailable.
    }
  }
};

export const authSupabase = hasAuthSupabaseConfig
  ? createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: safeAuthStorage
    }
  })
  : null;
