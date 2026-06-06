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
  return {
    addr,
    name: wallet.name?.trim() || walletNameFor(addr),
    categories: Array.isArray(wallet.categories) ? wallet.categories : [],
    chain: wallet.chain || 'All Chains',
    timestamp: wallet.timestamp || Date.now(),
    lastBalance: wallet.lastBalance,
    lastWinRate: wallet.lastWinRate,
    lastPnl: wallet.lastPnl
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
    const next: SavedWallet = {
      addr: address,
      name: name.trim() || walletNameFor(address),
      categories,
      chain,
      timestamp: previous?.timestamp || Date.now(),
      lastBalance: previous?.lastBalance,
      lastWinRate: previous?.lastWinRate,
      lastPnl: previous?.lastPnl
    };

    if (index >= 0) {
      wallets[index] = next;
    } else {
      wallets.push(next);
    }

    writeWallets(wallets);
    return next;
  },

  ensure(address: string, chain: WalletChain) {
    const existing = WalletStorage.get(address);
    if (existing) return existing;
    return WalletStorage.save(address, walletNameFor(address), [], chain);
  },

  updateStats(address: string, stats: { balance: string; winRate: string; pnl: string }) {
    const wallets = readWallets();
    const index = wallets.findIndex((wallet) => wallet.addr.toLowerCase() === address.toLowerCase());
    if (index < 0) return;
    wallets[index] = {
      ...wallets[index],
      lastBalance: stats.balance,
      lastWinRate: stats.winRate,
      lastPnl: stats.pnl
    };
    writeWallets(wallets);
  },

  delete(address: string) {
    writeWallets(readWallets().filter((wallet) => wallet.addr.toLowerCase() !== address.toLowerCase()));
  }
};
