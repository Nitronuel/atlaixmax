import type { SavedWallet } from '../../src/features/wallet-tracker/wallet-types';
import { readEnv } from '../env';

type SmartMoneyRow = {
  wallet_address: string;
  name: string;
  categories?: string[];
  chain?: string;
  last_balance?: string | null;
  last_win_rate?: string | null;
  last_pnl?: string | null;
  smart_money_score?: number | null;
  qualification?: SavedWallet['qualification'] | null;
  created_at?: string;
};

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url: url.replace(/\/$/, ''), key };
}

async function supabaseJson<T>(path: string, init: RequestInit = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for Smart Money.');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase Smart Money request failed (${response.status}). ${message}`.trim());
  }

  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function mapRowToWallet(row: SmartMoneyRow): SavedWallet {
  return {
    addr: row.wallet_address,
    name: row.name || `Wallet ${row.wallet_address.slice(0, 6)}...${row.wallet_address.slice(-4)}`,
    categories: (Array.isArray(row.categories) && row.categories.length ? row.categories : ['Smart Money']) as SavedWallet['categories'],
    chain: (row.chain || 'All Chains') as SavedWallet['chain'],
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    lastBalance: row.last_balance || undefined,
    lastWinRate: row.last_win_rate || undefined,
    lastPnl: row.last_pnl || undefined,
    qualification: row.qualification || undefined
  };
}

function isQualified(wallet: SavedWallet) {
  return Boolean(wallet.addr?.trim() && wallet.qualification?.qualified && wallet.qualification.score >= 65);
}

export const SmartMoneyDatabase = {
  async listWallets() {
    const rows = await supabaseJson<SmartMoneyRow[]>(
      'smart_money_wallets?select=*&order=smart_money_score.desc,updated_at.desc&limit=100'
    );
    return rows.map(mapRowToWallet);
  },

  async promoteWallet(wallet: SavedWallet) {
    if (!wallet || typeof wallet !== 'object') {
      throw new Error('Wallet payload is required.');
    }

    if (!isQualified(wallet)) {
      throw new Error('Wallet does not meet Smart Money qualification requirements.');
    }

    const categories = new Set(wallet.categories || []);
    categories.add('Smart Money');

    const payload = {
      wallet_address: wallet.addr,
      name: wallet.name,
      categories: [...categories],
      chain: wallet.chain,
      last_balance: wallet.lastBalance || null,
      last_win_rate: wallet.lastWinRate || null,
      last_pnl: wallet.lastPnl || null,
      smart_money_score: wallet.qualification?.score || 0,
      qualification: wallet.qualification,
      source: 'wallet-tracker',
      promotion_scope: 'global',
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await supabaseJson<null>('smart_money_wallets?on_conflict=wallet_address', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    });

    return payload;
  }
};
