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
  id?: string;
  symbol: string;
  name?: string;
  address: string;
  balance: string;
  value: string;
  price: string;
  currentPrice: number;
  rawValue: number;
  rawBalance?: number;
  logo?: string;
  chain?: WalletChain;
  chainLogo?: string;
  positionType?: string;
  dapp?: string;
  change24h?: string;
  isStablecoin?: boolean;
  pnl?: string;
  pnlPercent?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  totalPnl?: number;
  totalReturnPct?: number;
  openCostBasisUsd?: number;
  openReturnPct?: number;
  costBasisUsd?: number;
  proceedsUsd?: number;
  pnlSource?: 'zerion' | 'fifo' | 'transfer_baseline' | 'missing_basis' | 'stablecoin';
  pnlConfidence?: 'high' | 'medium' | 'low';
  buyTime?: number;
  performanceStatus?: 'reported' | 'partial_history' | 'cost_basis_missing' | 'unknown';
  timeHeldStatus?: 'reported' | 'partial_history' | 'unknown';
};

export type WalletStats = {
  winRate: string;
  totalPnl: string;
  realizedPnl: string;
  unrealizedPnl: string;
  netWorth: string;
  activePositions: number | string;
  profitablePositions: string;
  avgHoldTime: string;
};

export type WalletPnlSummary = {
  totalGain: number;
  totalGainPercent?: number;
  realizedGain: number;
  unrealizedGain: number;
  netInvested: number;
  totalFee: number;
  receivedExternal?: number;
  sentExternal?: number;
};

export type WalletTradePerformance = {
  id: string;
  token: {
    address?: string;
    symbol: string;
    logo?: string;
  };
  realizedPnl?: number;
  unrealizedPnl?: number;
  totalPnl?: number;
  returnPct?: number;
  invested?: number;
  realizedCostBasis?: number;
  openCostBasis?: number;
  status: 'Open position' | 'Partial' | 'Closed' | 'Cost basis missing';
};

export type WalletOverview = {
  netWorth: number;
  change24h?: number;
  chainDistribution: Array<{ chain: WalletChain | string; value: number; percent?: number }>;
  positionDistribution: Array<{ type: string; value: number; percent?: number }>;
};

export type WalletPortfolio = {
  netWorth: string;
  assets: WalletAsset[];
  providerStatus: 'ready' | 'provider_missing' | 'error';
  message?: string;
  generatedAt: string;
  overview?: WalletOverview;
  pnl?: WalletPnlSummary;
  tradePerformance?: WalletTradePerformance[];
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
  blockNumber?: string;
  explorerUrl: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'zerion';
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
