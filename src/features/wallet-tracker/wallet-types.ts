import type { SmartMoneyQualification, SmartMoneyTier } from '../../shared/smart-money-qualification';

export type { SmartMoneyQualification, SmartMoneyTier };

export type WalletChain = 'All Chains' | 'Ethereum' | 'Solana' | 'Base' | 'BSC' | 'Arbitrum' | 'Optimism' | 'Polygon' | 'Avalanche';

export type WalletAddressType = 'evm' | 'solana';

export type WalletCategory = 'Smart Money' | 'Whale' | 'Sniper' | 'Fresh Wallet' | 'Early Buyer';

export type WalletTimeFilter = 'ALL' | '1D' | '1W' | '1M' | '>1M';

export type SavedWallet = {
  addr: string;
  name: string;
  categories: WalletCategory[];
  chain: WalletChain;
  timestamp: number;
  lastBalance?: string;
  lastWinRate?: string;
  lastPnl?: string;
  qualification?: SmartMoneyQualification;
};

export type WalletAsset = {
  symbol: string;
  address: string;
  balance: string;
  value: string;
  price: string;
  currentPrice: number;
  rawValue: number;
  logo?: string;
  chain?: WalletChain;
  chainLogo?: string;
  pnl?: string;
  pnlPercent?: number;
  buyTime?: number;
};

export type WalletStats = {
  winRate: string;
  totalPnl: string;
  netWorth: string;
  activePositions: number | string;
  profitablePositions: string;
  avgHoldTime: string;
};

export type WalletPortfolio = {
  netWorth: string;
  assets: WalletAsset[];
  providerStatus: 'ready' | 'provider_missing' | 'error';
  message?: string;
  generatedAt: string;
};

export type WalletActivityKind = 'buy' | 'sell' | 'swap' | 'receive' | 'send' | 'approval' | 'contract' | 'unknown';

export type WalletActivityFilter = 'all' | WalletActivityKind | 'large';

export type WalletActivityToken = {
  address?: string;
  symbol: string;
  name?: string;
  amount?: string;
  usdValue?: number;
  logo?: string;
};

export type WalletActivityItem = {
  id: string;
  hash: string;
  chain: WalletChain;
  kind: WalletActivityKind;
  timestamp: number;
  title: string;
  summary: string;
  tokenIn?: WalletActivityToken;
  tokenOut?: WalletActivityToken;
  tokens: WalletActivityToken[];
  usdValue?: number;
  protocol?: string;
  counterparty?: string;
  explorerUrl: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'moralis_history' | 'moralis_swaps' | 'alchemy_transfers';
};

export type WalletTradedToken = {
  address?: string;
  symbol: string;
  logo?: string;
  chain: WalletChain;
  buys: number;
  sells: number;
  swaps: number;
  receives: number;
  sends: number;
  totalUsdVolume: number;
  lastActivityAt: number;
};

export type WalletActivitySummary = {
  lastActiveAt: number;
  recentBuys: number;
  recentSells: number;
  largestMoveUsd: number;
  largestMoveLabel: string;
  mostTradedToken: string;
  netFlowUsd: number;
};

export type WalletActivity = {
  activities: WalletActivityItem[];
  summary: WalletActivitySummary;
  tradedTokens: WalletTradedToken[];
  providerStatus: 'ready' | 'provider_missing' | 'partial' | 'error';
  message?: string;
  generatedAt: string;
};

export type SupportedWalletChain = {
  id: WalletChain;
  name: string;
  symbol: string;
  aggregate?: boolean;
};
