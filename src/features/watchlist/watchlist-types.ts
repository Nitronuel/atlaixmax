export type WatchlistAssetType = 'token' | 'coin';

export type WatchlistMonitorSettings = {
  detectionEvents: boolean;
  safeScanChanges: boolean;
  liquidityChanges: boolean;
  riskChanges: boolean;
  aiStateChanges: boolean;
  majorVolumeEvents: boolean;
};

export type WatchlistAsset = {
  id: string;
  userId: string;
  assetType: WatchlistAssetType;
  chainId: string | null;
  tokenAddress: string | null;
  pairAddress: string | null;
  coinId: string | null;
  symbol: string;
  name: string;
  imageUrl: string | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  liquidityUsd: number | null;
  riskLevel: string | null;
  state: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  monitorSettings: WatchlistMonitorSettings;
  lastSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type WatchlistAssetInput = {
  assetType: WatchlistAssetType;
  chainId?: string | null;
  tokenAddress?: string | null;
  pairAddress?: string | null;
  coinId?: string | null;
  symbol?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  priceUsd?: number | null;
  priceChange24h?: number | null;
  liquidityUsd?: number | null;
  riskLevel?: string | null;
  state?: string | null;
  lastEventType?: string | null;
  lastEventAt?: string | null;
  monitorSettings?: Partial<WatchlistMonitorSettings> | null;
  lastSnapshot?: Record<string, unknown> | null;
};

export type WatchlistActivityTone = 'bullish' | 'bearish' | 'neutral' | 'risk';

export type WatchlistActivityItem = {
  id: string;
  assetId: string | null;
  assetSymbol: string;
  assetName: string;
  assetType: WatchlistAssetType;
  title: string;
  detail: string;
  tone: WatchlistActivityTone;
  source: 'detection' | 'smart-alert' | 'watchlist';
  createdAt: string;
  href: string | null;
};

export type WatchlistMetric = {
  label: string;
  value: number;
  note: string;
};

export type WatchlistSummary = {
  generatedAt: string;
  metrics: WatchlistMetric[];
  summary: string;
  activity: WatchlistActivityItem[];
};
