import type { SmartMoneyQualification, SupportedWalletChain, WalletAddressType, WalletAsset, WalletCategory, WalletChain, WalletPnlSummary, WalletStats } from './wallet-types';
import { evaluateSmartMoneyWallet } from '../../shared/smart-money-qualification';

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const WALLET_CATEGORIES: WalletCategory[] = ['Whale', 'Sniper', 'Fresh Wallet', 'Early Buyer'];

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
  return type === 'solana' ? 'Solana' : 'Ethereum';
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

export function parseCurrencyValue(value?: string | number) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const cleaned = value.replace(/[$,\s]/g, '').trim();
  const match = cleaned.match(/^([+-]?\d+(?:\.\d+)?)([KMBT])?$/i);
  if (!match) return Number(cleaned) || 0;
  const amount = Number(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  const multiplier = suffix === 'T' ? 1_000_000_000_000
    : suffix === 'B' ? 1_000_000_000
      : suffix === 'M' ? 1_000_000
        : suffix === 'K' ? 1_000
          : 1;
  return amount * multiplier;
}

export function parsePercentValue(value?: string | number) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value || value === 'N/A' || value === 'Calculating') return 0;
  return Number(value.replace('%', '').replace('+', '').trim()) || 0;
}

export function evaluateSmartMoney(stats: WalletStats): SmartMoneyQualification {
  const netWorthUsd = parseCurrencyValue(stats.netWorth);
  const winRate = parsePercentValue(stats.winRate);
  const pnlPercent = parsePercentValue(stats.totalPnl);
  const activePositions = typeof stats.activePositions === 'number' ? stats.activePositions : Number.parseInt(String(stats.activePositions), 10) || 0;
  const profitablePositions = Number.parseInt(stats.profitablePositions, 10) || 0;

  return evaluateSmartMoneyWallet({
    netWorthUsd,
    winRate,
    pnlPercent,
    activePositions,
    profitablePositions
  });
}

function formatPercent(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatCurrency(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
}

export function buildWalletStats(assets: WalletAsset[], fallbackNetWorth = '$0.00', pnl?: WalletPnlSummary): WalletStats {
  const activeAssets = assets.filter((asset) => asset.rawValue > 1);
  const pnlAssets = activeAssets.filter((asset) => !asset.isStablecoin && typeof asset.pnlPercent === 'number');
  const winners = pnlAssets.filter((asset) => (asset.pnlPercent || 0) > 0);
  const netWorth = assets.reduce((total, asset) => total + asset.rawValue, 0);
  let totalPnl = pnl ? formatCurrency(pnl.totalGain) : 'N/A';

  if (!pnl && pnlAssets.length) {
    let costBasis = 0;
    let currentValue = 0;
    pnlAssets.forEach((asset) => {
      const pnlPercent = Number(asset.pnlPercent || 0);
      const cost = asset.rawValue / (1 + (pnlPercent / 100));
      costBasis += Number.isFinite(cost) ? cost : 0;
      currentValue += asset.rawValue;
    });
    const pnlPercent = costBasis > 0 ? ((currentValue - costBasis) / costBasis) * 100 : 0;
    totalPnl = `${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`;
  }

  return {
    winRate: pnlAssets.length ? `${Math.round((winners.length / pnlAssets.length) * 100)}%` : pnl?.totalGainPercent !== undefined ? formatPercent(pnl.totalGainPercent) : 'N/A',
    totalPnl,
    realizedPnl: pnl ? formatCurrency(pnl.realizedGain) : 'N/A',
    unrealizedPnl: pnl ? formatCurrency(pnl.unrealizedGain) : 'N/A',
    netWorth: netWorth > 0 ? netWorth.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : fallbackNetWorth,
    activePositions: activeAssets.length,
    profitablePositions: pnlAssets.length ? String(winners.length) : 'N/A',
    avgHoldTime: 'N/A'
  };
}
