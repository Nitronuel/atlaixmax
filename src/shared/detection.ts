export type DetectionSentiment = 'bullish' | 'bearish' | 'neutral';
export type DetectionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DetectionLifecycleStatus = 'new' | 'active' | 'strengthening' | 'weakening' | 'confirmed' | 'failed' | 'expired';

export type DetectionEvent = {
  id: string;
  eventType: string;
  summary: string;
  sentiment: DetectionSentiment;
  severity: DetectionSeverity;
  score: number;
  detectedAt: number;
  token: {
    name: string;
    ticker: string;
    address: string;
    chain: string;
    pairAddress: string;
    logo?: string;
  };
  metrics: {
    volume24h: number;
    liquidity: number;
    marketCap: number;
    priceChange24h: number;
    netFlow: number;
  };
  classificationId: string;
  dedupeKey: string;
  lifecycleId?: string;
  lifecycleStatus?: DetectionLifecycleStatus;
  eventVersion?: number;
  lastUpdatedAt?: number;
  previousScore?: number | null;
  scoreDelta?: number | null;
  riskDelta?: number | null;
};

export type DetectionEventsResponse = {
  generatedAt: string;
  events: DetectionEvent[];
};

export type DetectionStatusResponse = {
  enabled: boolean;
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastRunStatus: 'idle' | 'success' | 'error' | 'skipped';
  lastError: string;
  intervalMs: number;
  batchSize: number;
  scanned: number;
  classified: number;
  failed: number;
  eventsCreated: number;
};

export type DetectionTokenDetailResponse = {
  generatedAt: string;
  token: {
    tokenId: string;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenAddress: string;
    chain: string;
    pairAddress: string;
    dexId: string | null;
    pairUrl: string | null;
    logo?: string | null;
  } | null;
  latestSnapshot: unknown | null;
  latestFeatures: unknown | null;
  latestClassification: unknown | null;
  events: DetectionEvent[];
  snapshotHistory: unknown[];
  classificationHistory: unknown[];
};
