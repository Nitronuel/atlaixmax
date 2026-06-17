export type CoinGeckoEvent =
  | 'Strong Momentum'
  | 'Volume Expansion'
  | 'Recovery Attempt'
  | 'Sell Pressure'
  | 'Market Leader'
  | 'Range Cooling'
  | 'Unusual Activity';

export type CoinGeckoCoin = {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  marketCapRank: number | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  change30d: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  ath: number | null;
  athChangePercentage: number | null;
  atl: number | null;
  atlChangePercentage: number | null;
  sparkline7d: number[];
  event: CoinGeckoEvent;
  lastSeenAt: string;
};

export type CoinGeckoFeedResponse = {
  generatedAt: string;
  coins: CoinGeckoCoin[];
};

export type CoinGeckoCoinDetails = CoinGeckoCoin & {
  description?: string;
  homepage?: string;
  links: Array<{ label: string; url: string }>;
  categories: string[];
};

export type CoinGeckoChartPoint = {
  timestamp: number;
  price: number;
};

export type CoinGeckoCoinDetailsResponse = {
  generatedAt: string;
  coin: CoinGeckoCoinDetails;
};

export type CoinGeckoChartResponse = {
  generatedAt: string;
  coinId: string;
  days: number;
  prices: CoinGeckoChartPoint[];
};
