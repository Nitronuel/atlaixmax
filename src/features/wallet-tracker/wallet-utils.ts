import type { SmartMoneyQualification, SupportedWalletChain, WalletAddressType, WalletAsset, WalletCategory, WalletChain, WalletStats } from './wallet-types';

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

function roundScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateSmartMoney(stats: WalletStats): SmartMoneyQualification {
  const netWorthUsd = parseCurrencyValue(stats.netWorth);
  const winRate = parsePercentValue(stats.winRate);
  const pnlPercent = parsePercentValue(stats.totalPnl);
  const activePositions = typeof stats.activePositions === 'number' ? stats.activePositions : Number.parseInt(String(stats.activePositions), 10) || 0;
  const profitablePositions = Number.parseInt(stats.profitablePositions, 10) || 0;
  const reasons: string[] = [];
  let score = 0;

  if (netWorthUsd >= 100_000) {
    score += 25;
    reasons.push(`Strong capital base with ${stats.netWorth} in tracked value`);
  } else if (netWorthUsd >= 25_000) {
    score += 18;
    reasons.push(`Healthy capital base with ${stats.netWorth} in tracked value`);
  } else if (netWorthUsd >= 10_000) {
    score += 10;
  }

  if (winRate >= 75) {
    score += 25;
    reasons.push(`High win rate at ${stats.winRate}`);
  } else if (winRate >= 60) {
    score += 18;
    reasons.push(`Solid win rate at ${stats.winRate}`);
  } else if (winRate >= 50) {
    score += 10;
  }

  if (pnlPercent >= 50) {
    score += 25;
    reasons.push(`Exceptional PnL at ${stats.totalPnl}`);
  } else if (pnlPercent >= 20) {
    score += 18;
    reasons.push(`Positive PnL at ${stats.totalPnl}`);
  } else if (pnlPercent >= 10) {
    score += 10;
  }

  if (activePositions >= 8) {
    score += 15;
    reasons.push(`${activePositions} active positions show broad activity`);
  } else if (activePositions >= 4) {
    score += 10;
    reasons.push(`${activePositions} active positions provide enough activity to assess`);
  } else if (activePositions >= 2) {
    score += 5;
  }

  if (profitablePositions >= 5) {
    score += 10;
    reasons.push(`${profitablePositions} profitable positions support consistency`);
  } else if (profitablePositions >= 3) {
    score += 7;
  } else if (profitablePositions >= 1) {
    score += 3;
  }

  if (pnlPercent < 0) score -= 15;
  if (winRate > 0 && winRate < 35) score -= 10;
  if (netWorthUsd > 0 && netWorthUsd < 2_500) score -= 10;

  const normalizedScore = roundScore(score);
  const qualified = netWorthUsd >= 100_000 &&
    winRate >= 55 &&
    pnlPercent >= 10 &&
    activePositions >= 3 &&
    profitablePositions >= 2 &&
    normalizedScore >= 65;

  return {
    score: normalizedScore,
    qualified,
    reasons: reasons.slice(0, 4),
    evaluatedAt: Date.now(),
    metrics: {
      netWorthUsd,
      winRate,
      pnlPercent,
      activePositions,
      profitablePositions
    }
  };
}

export function buildWalletStats(assets: WalletAsset[], fallbackNetWorth = '$0.00'): WalletStats {
  const activeAssets = assets.filter((asset) => asset.rawValue > 1);
  const pnlAssets = activeAssets.filter((asset) => typeof asset.pnlPercent === 'number');
  const winners = pnlAssets.filter((asset) => (asset.pnlPercent || 0) > 0);
  const netWorth = assets.reduce((total, asset) => total + asset.rawValue, 0);
  let totalPnl = 'N/A';

  if (pnlAssets.length) {
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
    winRate: pnlAssets.length ? `${Math.round((winners.length / pnlAssets.length) * 100)}%` : 'N/A',
    totalPnl,
    netWorth: netWorth > 0 ? netWorth.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : fallbackNetWorth,
    activePositions: activeAssets.length,
    profitablePositions: pnlAssets.length ? String(winners.length) : 'N/A',
    avgHoldTime: 'N/A'
  };
}
