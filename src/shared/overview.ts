export type OverviewToken = {
  id: string;
  chain: string;
  dex: string;
  name: string;
  symbol: string;
  address: string;
  pairAddress: string;
  url: string;
  logo?: string;
  priceUsd: number | null;
  change24h: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number;
  liquidityUsd: number;
  dexBuys24h: number;
  dexSells24h: number;
  dexFlow24h: number;
  dexFlowUsd24h: number;
  event: OverviewEvent;
  pairCreatedAt: number | null;
  marketDataUpdatedAt: string | null;
};

export type OverviewEvent =
  | 'Accumulation'
  | 'Momentum Breakout'
  | 'Flow Imbalance'
  | 'Liquidity Event'
  | 'Thin Liquidity Risk'
  | 'Market Stress'
  | 'Market Watch';

export type OverviewFeedResponse = {
  generatedAt: string;
  tokens: OverviewToken[];
};
