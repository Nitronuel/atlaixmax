import { apiUrl } from '../../config';
import type { SavedWallet } from '../wallet-tracker/wallet-types';

async function fetchJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });
  const body = await response.json().catch(() => null) as { error?: string } | T | null;

  if (!response.ok) {
    throw new Error((body as { error?: string } | null)?.error || 'Smart Money request failed.');
  }

  return body as T;
}

export const SmartMoneyService = {
  async listWallets(signal?: AbortSignal) {
    const payload = await fetchJson<{ wallets?: SavedWallet[] }>('/api/smart-money/wallets', { signal });
    return payload.wallets || [];
  },

  async promoteWallet(wallet: SavedWallet) {
    return fetchJson<{ promoted: boolean }>('/api/smart-money/wallets', {
      method: 'POST',
      body: JSON.stringify({ wallet })
    });
  }
};
