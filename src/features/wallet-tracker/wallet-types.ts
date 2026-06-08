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

export type SmartMoneyQualification = {
  score: number;
  qualified: boolean;
  reasons: string[];
  evaluatedAt: number;
  metrics: {
    netWorthUsd: number;
    winRate: number;
    pnlPercent: number;
    activePositions: number;
    profitablePositions: number;
  };
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

export type SupportedWalletChain = {
  id: WalletChain;
  name: string;
  symbol: string;
  aggregate?: boolean;
};
