import type { SavedWallet, WalletCategory, WalletChain } from './wallet-types';
import { walletNameFor } from './wallet-utils';

const STORAGE_KEY = 'atlaix:saved-wallets';

function readWallets(): SavedWallet[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as SavedWallet[];
    return Array.isArray(parsed) ? parsed.map(normalizeWallet) : [];
  } catch {
    return [];
  }
}

function writeWallets(wallets: SavedWallet[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
}

function normalizeWallet(wallet: Partial<SavedWallet> & { addr?: string }) {
  const addr = wallet.addr || '';
  const qualification = wallet.qualification;
  const categories = Array.isArray(wallet.categories)
    ? wallet.categories.filter((category) => category !== 'Smart Money' || qualification?.qualified)
    : [];
  return {
    addr,
    name: wallet.name?.trim() || walletNameFor(addr),
    categories,
    chain: wallet.chain || 'All Chains',
    timestamp: wallet.timestamp || Date.now(),
    lastBalance: wallet.lastBalance,
    lastWinRate: wallet.lastWinRate,
    lastPnl: wallet.lastPnl,
    qualification
  } satisfies SavedWallet;
}

export const WalletStorage = {
  list() {
    return readWallets().sort((a, b) => b.timestamp - a.timestamp);
  },

  get(address: string) {
    return readWallets().find((wallet) => wallet.addr.toLowerCase() === address.toLowerCase());
  },

  save(address: string, name: string, categories: WalletCategory[], chain: WalletChain) {
    const wallets = readWallets();
    const index = wallets.findIndex((wallet) => wallet.addr.toLowerCase() === address.toLowerCase());
    const previous = index >= 0 ? wallets[index] : null;
    const qualification = previous?.qualification;
    const nextCategories = qualification?.qualified
      ? Array.from(new Set([...categories, 'Smart Money' as const]))
      : categories.filter((category) => category !== 'Smart Money');
    const next: SavedWallet = {
      addr: address,
      name: name.trim() || walletNameFor(address),
      categories: nextCategories,
      chain,
      timestamp: previous?.timestamp || Date.now(),
      lastBalance: previous?.lastBalance,
      lastWinRate: previous?.lastWinRate,
      lastPnl: previous?.lastPnl,
      qualification
    };

    if (index >= 0) {
      wallets[index] = next;
    } else {
      wallets.push(next);
    }

    writeWallets(wallets);
    return next;
  },

  updateStats(address: string, stats: { balance: string; winRate: string; pnl: string; qualification?: SavedWallet['qualification'] }) {
    const wallets = readWallets();
    const index = wallets.findIndex((wallet) => wallet.addr.toLowerCase() === address.toLowerCase());
    if (index < 0) return;
    const qualification = stats.qualification;
    const baseCategories = wallets[index].categories.filter((category) => category !== 'Smart Money');
    const categories = qualification?.qualified ? [...baseCategories, 'Smart Money' as const] : baseCategories;
    wallets[index] = {
      ...wallets[index],
      categories,
      lastBalance: stats.balance,
      lastWinRate: stats.winRate,
      lastPnl: stats.pnl,
      qualification
    };
    writeWallets(wallets);
  },

  delete(address: string) {
    writeWallets(readWallets().filter((wallet) => wallet.addr.toLowerCase() !== address.toLowerCase()));
  }
};
