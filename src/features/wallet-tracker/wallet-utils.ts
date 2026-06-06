import type { SupportedWalletChain, WalletAddressType, WalletAsset, WalletCategory, WalletChain, WalletStats } from './wallet-types';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const WALLET_CATEGORIES: WalletCategory[] = ['Smart Money', 'Whale', 'Sniper', 'Fresh Wallet', 'Early Buyer'];

export const WALLET_CHAINS: SupportedWalletChain[] = [
  { id: 'All Chains', name: 'All Chains', symbol: 'ALL', aggregate: true },
  { id: 'Ethereum', name: 'Ethereum', symbol: 'ETH' },
  { id: 'Solana', name: 'Solana', symbol: 'SOL' },
  { id: 'Base', name: 'Base', symbol: 'BASE' },
  { id: 'BSC', name: 'BNB Smart Chain', symbol: 'BSC' },
  { id: 'Arbitrum', name: 'Arbitrum', symbol: 'ARB' },
  { id: 'Optimism', name: 'Optimism', symbol: 'OP' },
  { id: 'Polygon', name: 'Polygon', symbol: 'MATIC' },
  { id: 'Avalanche', name: 'Avalanche', symbol: 'AVAX' }
];

export function detectWalletAddressType(value: string): WalletAddressType | null {
  const normalized = value.trim();
  if (EVM_ADDRESS_REGEX.test(normalized)) return 'evm';
  if (!normalized.startsWith('0x') && SOLANA_ADDRESS_REGEX.test(normalized)) return 'solana';
  return null;
}

export function validateWalletAddress(value: string) {
  const normalizedAddress = value.trim();
  if (!normalizedAddress) {
    return { isValid: false, type: null, normalizedAddress, error: 'Enter a wallet address.' };
  }

  const type = detectWalletAddressType(normalizedAddress);
  if (!type) {
    return { isValid: false, type: null, normalizedAddress, error: 'Enter a valid EVM or Solana wallet address.' };
  }

  return { isValid: true, type, normalizedAddress, error: '' };
}

export function getDefaultChain(type: WalletAddressType | null): WalletChain {
  return type === 'solana' ? 'Solana' : 'All Chains';
}

export function isChainCompatible(chain: WalletChain, type: WalletAddressType | null) {
  if (!type) return false;
  if (type === 'solana') return chain === 'Solana';
  return chain !== 'Solana';
}

export function normalizeWalletChain(value: string | null | undefined): WalletChain {
  const matched = WALLET_CHAINS.find((chain) => chain.id.toLowerCase() === (value || '').toLowerCase());
  return matched?.id || 'All Chains';
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function walletNameFor(address: string) {
  return `Wallet ${shortAddress(address)}`;
}

export function formatTimeHeld(timestamp?: number) {
  if (!timestamp) return 'N/A';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${(days / 30).toFixed(1)}mo`;
  if (days >= 7) return `${Math.floor(days / 7)}w`;
  return `${days}d`;
}

export function buildWalletStats(assets: WalletAsset[], fallbackNetWorth = '$0.00'): WalletStats {
  const activeAssets = assets.filter((asset) => asset.rawValue > 1);
  const pnlAssets = activeAssets.filter((asset) => typeof asset.pnlPercent === 'number');
  const winners = pnlAssets.filter((asset) => (asset.pnlPercent || 0) > 0);
  const netWorth = assets.reduce((total, asset) => total + asset.rawValue, 0);

  return {
    winRate: pnlAssets.length ? `${Math.round((winners.length / pnlAssets.length) * 100)}%` : 'N/A',
    totalPnl: pnlAssets.length ? 'Calculating' : 'N/A',
    netWorth: netWorth > 0 ? netWorth.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : fallbackNetWorth,
    activePositions: activeAssets.length,
    profitablePositions: pnlAssets.length ? String(winners.length) : 'N/A',
    avgHoldTime: 'N/A'
  };
}
