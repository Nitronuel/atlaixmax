import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import type { DetectionEvent, DetectionEventsResponse, DetectionSeverity, DetectionSentiment, DetectionTokenDetailResponse } from '../../src/shared/detection';
import { readEnv } from '../env';
import type { EventStatus, FinalClassification, PrimaryLabel, RiskLevel, ScanTier, Token, TokenFeatures, TokenSchedulePatch, TokenSnapshot } from './types';

export type StoredToken = Token & {
  logo?: string | null;
  overviewEvent?: string | null;
  overviewVolume24h?: number | null;
  overviewLiquidity?: number | null;
  lastDetectionCheckedAt?: string | null;
  scanTier?: ScanTier | null;
  nextDetectionCheckAt?: string | null;
  detectionPriorityScore?: number | null;
  failedHydrationCount?: number | null;
  lastPrimaryLabel?: PrimaryLabel | null;
  lastRiskLevel?: RiskLevel | null;
  lastEventStatus?: EventStatus | null;
  consecutiveQuietCount?: number | null;
};

type StoredClassification = FinalClassification & { classificationId: string };

type DetectionRunPatch = {
  id?: string;
  startedAt: string;
  completedAt?: string | null;
  status: 'running' | 'success' | 'error' | 'skipped';
  scannedCount?: number;
  classifiedCount?: number;
  failedCount?: number;
  eventCount?: number;
  error?: string | null;
};

type DetectionState = {
  tokens: Record<string, StoredToken>;
  snapshots: Record<string, TokenSnapshot[]>;
  features: Record<string, TokenFeatures[]>;
  classifications: Record<string, StoredClassification[]>;
  events: DetectionEvent[];
  runs: DetectionRunPatch[];
};

export type DetectionEventFilters = {
  q?: string;
  chain?: string;
  severity?: DetectionSeverity | 'all';
  sentiment?: DetectionSentiment | 'all';
  limit?: number;
};

const TOKEN_COLUMNS = 'token_id,token_name,token_symbol,token_address,chain,pair_address,dex_id,pair_url,logo_url,overview_event,overview_volume_24h,overview_liquidity,last_detection_checked_at,created_at,updated_at';
const TOKEN_QUEUE_COLUMNS = `${TOKEN_COLUMNS},scan_tier,next_detection_check_at,detection_priority_score,failed_hydration_count,last_primary_label,last_risk_level,last_event_status,consecutive_quiet_count`;
const EVENT_BASE_COLUMNS = 'id,token_id,classification_id,event_type,summary,sentiment,severity,score,detected_at,token,metrics,dedupe_key,created_at';
const EVENT_COLUMNS = `${EVENT_BASE_COLUMNS},lifecycle_id,lifecycle_status,event_version,last_updated_at,previous_score,score_delta,risk_delta`;
const SNAPSHOT_COLUMNS = 'snapshot_id,token_id,timestamp,price_usd,market_cap,liquidity_usd,volume_5m,volume_1h,volume_6h,volume_24h,buys_5m,sells_5m,traders_5m,price_change_5m,price_change_1h,price_change_6h,price_change_24h,raw';
const FEATURE_COLUMNS = 'feature_id,token_id,timestamp,total_txns_5m,buy_sell_ratio,buy_txn_dominance,sell_txn_dominance,net_txn_pressure,liquidity_change_percentage,liquidity_change_usd,volume_to_liquidity_ratio,volume_spike_score,volume_spike_persisted_snapshots,volume_quality_score,volume_quality_level,liquidity_regime,price_momentum_score,volatility_score,consecutive_green_snapshots,consecutive_red_snapshots,consecutive_buy_dominant_snapshots,consecutive_sell_dominant_snapshots,trend_direction,liquidity_state,pressure_state';
const CLASSIFICATION_BASE_COLUMNS = 'classification_id,token_id,timestamp,rule_label,rule_confidence,final_label,final_confidence,risk_level,reason,primary_label,display_label,market_phase,structural_regime,active_regime,dominant_timeframe,dominant_reason,lower_timeframe_trigger,timeframe_alignment,trend_change,event_status,confidence_breakdown,risk,manipulation_risk,timeframe_scores,liquidity_regime,volume_quality,alert_priority,secondary_signals,contradictory_signals,warnings,evidence,detector_scores,data_quality,rule_version';
const CLASSIFICATION_COLUMNS = `${CLASSIFICATION_BASE_COLUMNS},event_horizon,confirmation_status,confirmation_score,classification_basis,token_age_minutes,regime_weights,pair_reliability`;
const CLASSIFICATION_SUMMARY_COLUMNS = 'classification_id,token_id,timestamp,rule_label,rule_confidence,final_label,final_confidence,risk_level,reason,primary_label,display_label';
const INTERNAL_HISTORY_TABLES = ['detection_features', 'detection_snapshots', 'detection_classifications'] as const;
const DEFAULT_HISTORY_RETENTION_HOURS = 24;
const HISTORY_RETENTION_INTERVAL_MS = 15 * 60 * 1000;

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function getLocalPath() {
  return resolve(process.cwd(), '.data', 'detection-engine.json');
}

function getHistoryRetentionHours() {
  const configured = Number(readEnv('DETECTION_HISTORY_RETENTION_HOURS'));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_HISTORY_RETENTION_HOURS;
}

function readLocalState(): DetectionState {
  const filepath = getLocalPath();
  if (!existsSync(filepath)) {
    return { tokens: {}, snapshots: {}, features: {}, classifications: {}, events: [], runs: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf8')) as DetectionState;
    return {
      tokens: parsed.tokens || {},
      snapshots: parsed.snapshots || {},
      features: parsed.features || {},
      classifications: parsed.classifications || {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : []
    };
  } catch {
    return { tokens: {}, snapshots: {}, features: {}, classifications: {}, events: [], runs: [] };
  }
}

function writeLocalState(state: DetectionState) {
  const filepath = getLocalPath();
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(state, null, 2));
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for Detection Engine.');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase Detection request failed (${response.status}). ${message}`.trim());
  }

  if (response.status === 204) return null as T;
  return response.json().catch(() => null) as T;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenFromRow(row: Record<string, any>): StoredToken {
  return {
    tokenId: String(row.token_id || ''),
    tokenName: row.token_name || null,
    tokenSymbol: row.token_symbol || null,
    tokenAddress: String(row.token_address || ''),
    chain: String(row.chain || ''),
    pairAddress: String(row.pair_address || ''),
    dexId: row.dex_id || null,
    pairUrl: row.pair_url || null,
    logo: row.logo_url || null,
    overviewEvent: row.overview_event || null,
    overviewVolume24h: toNumber(row.overview_volume_24h),
    overviewLiquidity: toNumber(row.overview_liquidity),
    lastDetectionCheckedAt: row.last_detection_checked_at || null,
    scanTier: row.scan_tier || null,
    nextDetectionCheckAt: row.next_detection_check_at || null,
    detectionPriorityScore: toNumber(row.detection_priority_score),
    failedHydrationCount: row.failed_hydration_count === undefined ? null : Number(row.failed_hydration_count || 0),
    lastPrimaryLabel: row.last_primary_label || null,
    lastRiskLevel: row.last_risk_level || null,
    lastEventStatus: row.last_event_status || null,
    consecutiveQuietCount: row.consecutive_quiet_count === undefined ? null : Number(row.consecutive_quiet_count || 0)
  };
}

function snapshotFromRow(row: Record<string, any>): TokenSnapshot {
  return {
    tokenId: String(row.token_id || ''),
    timestamp: String(row.timestamp || ''),
    priceUsd: toNumber(row.price_usd),
    marketCap: toNumber(row.market_cap),
    liquidityUsd: toNumber(row.liquidity_usd),
    volume5m: toNumber(row.volume_5m) || 0,
    volume1h: toNumber(row.volume_1h) || 0,
    volume6h: toNumber(row.volume_6h) || 0,
    volume24h: toNumber(row.volume_24h) || 0,
    buys5m: Number(row.buys_5m || 0),
    sells5m: Number(row.sells_5m || 0),
    traders5m: Number(row.traders_5m || 0),
    priceChange5m: toNumber(row.price_change_5m) || 0,
    priceChange1h: toNumber(row.price_change_1h) || 0,
    priceChange6h: toNumber(row.price_change_6h) || 0,
    priceChange24h: toNumber(row.price_change_24h) || 0,
    pairCreatedAt: toNumber(row.raw?.pair?.pairCreatedAt) ?? toNumber(row.raw?.overview?.pairCreatedAt),
    pairReliability: row.raw?.pairReliability || null,
    raw: row.raw
  };
}

function featureFromRow(row: Record<string, any>): TokenFeatures {
  return {
    tokenId: String(row.token_id || ''),
    timestamp: String(row.timestamp || ''),
    totalTxns5m: Number(row.total_txns_5m || 0),
    buySellRatio: toNumber(row.buy_sell_ratio) || 0,
    buyTxnDominance: toNumber(row.buy_txn_dominance) || 0,
    sellTxnDominance: toNumber(row.sell_txn_dominance) || 0,
    netTxnPressure: toNumber(row.net_txn_pressure) || 0,
    liquidityChangePercentage: toNumber(row.liquidity_change_percentage),
    liquidityChangeUsd: toNumber(row.liquidity_change_usd),
    volumeToLiquidityRatio: toNumber(row.volume_to_liquidity_ratio) || 0,
    volumeSpikeScore: toNumber(row.volume_spike_score) || 0,
    volumeSpikePersistedSnapshots: Number(row.volume_spike_persisted_snapshots || 0),
    volumeQualityScore: toNumber(row.volume_quality_score) || 0,
    volumeQualityLevel: row.volume_quality_level || 'poor',
    liquidityRegime: row.liquidity_regime || 'HEALTHY_LIQUIDITY',
    priceMomentumScore: toNumber(row.price_momentum_score) || 0,
    volatilityScore: toNumber(row.volatility_score) || 0,
    consecutiveGreenSnapshots: Number(row.consecutive_green_snapshots || 0),
    consecutiveRedSnapshots: Number(row.consecutive_red_snapshots || 0),
    consecutiveBuyDominantSnapshots: Number(row.consecutive_buy_dominant_snapshots || 0),
    consecutiveSellDominantSnapshots: Number(row.consecutive_sell_dominant_snapshots || 0),
    trendDirection: row.trend_direction || 'sideways',
    liquidityState: row.liquidity_state || 'unknown',
    pressureState: row.pressure_state || 'weak_activity'
  };
}

function emptyTimeframe(timeframe: '5m' | '1h' | '6h' | '24h') {
  return {
    timeframe,
    rawPriceChange: 0,
    normalizedMove: 0,
    direction: 'neutral',
    directionScore: 0,
    momentumScore: 0,
    volumeConfirmation: 'unknown',
    liquidityConfirmation: 'unknown',
    reliability: 0
  };
}

function classificationFromRow(row: Record<string, any>): StoredClassification {
  const finalConfidence = Number(row.final_confidence ?? row.rule_confidence ?? 0);
  const riskLevel = row.risk_level ?? row.risk?.level ?? 'low';
  const dataQuality = row.data_quality ?? {
    score: 0,
    historySnapshots: 0,
    missingFields: [],
    warnings: [],
    hasMinimumActivity: false,
    hasEnoughHistory: false,
    hasReliableLiquidity: false
  };

  return {
    classificationId: String(row.classification_id || ''),
    tokenId: String(row.token_id || ''),
    timestamp: String(row.timestamp || ''),
    ruleLabel: row.rule_label || 'UNKNOWN',
    ruleConfidence: Number(row.rule_confidence || finalConfidence),
    finalLabel: row.final_label || 'UNKNOWN',
    finalConfidence,
    riskLevel,
    reason: row.reason || '',
    primaryLabel: row.primary_label || row.final_label || 'UNKNOWN',
    displayLabel: row.display_label || String(row.primary_label || row.final_label || 'UNKNOWN').replaceAll('_', ' '),
    marketPhase: row.market_phase || 'UNKNOWN',
    structuralRegime: row.structural_regime || 'MIXED',
    activeRegime: row.active_regime || 'UNKNOWN',
    dominantTimeframe: row.dominant_timeframe || 'mixed',
    dominantReason: row.dominant_reason || '',
    eventHorizon: row.event_horizon || row.dominant_timeframe || 'mixed',
    confirmationStatus: row.confirmation_status || 'confirmed',
    confirmationScore: Number(row.confirmation_score ?? finalConfidence),
    classificationBasis: row.classification_basis || 'higher_timeframe_confirmed',
    lowerTimeframeTrigger: row.lower_timeframe_trigger || 'NONE',
    timeframeAlignment: row.timeframe_alignment || { status: 'mixed', score: 0, conflictSeverity: 'none' },
    trendChange: row.trend_change || 'UNCHANGED',
    eventStatus: row.event_status || 'new',
    confidence: row.confidence_breakdown || {
      triggerConfidence: finalConfidence,
      regimeConfidence: finalConfidence,
      interpretationConfidence: finalConfidence,
      dataConfidence: dataQuality.score,
      finalConfidence
    },
    risk: row.risk || { level: riskLevel, score: 0, reasons: [] },
    manipulationRisk: row.manipulation_risk || { level: 'low', score: 0, reasons: [] },
    timeframes: row.timeframe_scores || {
      m5: emptyTimeframe('5m'),
      h1: emptyTimeframe('1h'),
      h6: emptyTimeframe('6h'),
      h24: emptyTimeframe('24h')
    },
    liquidityRegime: row.liquidity_regime || 'HEALTHY_LIQUIDITY',
    volumeQuality: row.volume_quality || { score: 0, level: 'poor' },
    alertPriority: row.alert_priority || 'none',
    secondarySignals: row.secondary_signals || [],
    contradictorySignals: row.contradictory_signals || [],
    warnings: row.warnings || [],
    evidence: row.evidence || (row.reason ? [row.reason] : []),
    detectorScores: row.detector_scores || [],
    dataQuality,
    ruleVersion: row.rule_version || 'v3.0.0',
    tokenAgeMinutes: toNumber(row.token_age_minutes),
    regimeWeights: row.regime_weights || undefined,
    pairReliability: row.pair_reliability || null
  };
}

function eventFromRow(row: Record<string, any>): DetectionEvent {
  return {
    id: String(row.id || ''),
    eventType: String(row.event_type || 'Detection Event'),
    summary: String(row.summary || ''),
    sentiment: row.sentiment || 'neutral',
    severity: row.severity || 'low',
    score: Number(row.score || 0),
    detectedAt: Date.parse(row.detected_at || '') || Date.now(),
    token: {
      name: String(row.token?.name || ''),
      ticker: String(row.token?.ticker || ''),
      address: String(row.token?.address || ''),
      chain: String(row.token?.chain || ''),
      pairAddress: String(row.token?.pairAddress || ''),
      logo: row.token?.logo || undefined
    },
    metrics: {
      volume24h: Number(row.metrics?.volume24h || 0),
      liquidity: Number(row.metrics?.liquidity || 0),
      marketCap: Number(row.metrics?.marketCap || 0),
      priceChange24h: Number(row.metrics?.priceChange24h || 0),
      netFlow: Number(row.metrics?.netFlow || 0)
    },
    classificationId: String(row.classification_id || ''),
    dedupeKey: String(row.dedupe_key || ''),
    lifecycleId: row.lifecycle_id || undefined,
    lifecycleStatus: row.lifecycle_status || undefined,
    eventVersion: row.event_version === undefined ? undefined : Number(row.event_version || 1),
    lastUpdatedAt: row.last_updated_at ? (Date.parse(row.last_updated_at) || undefined) : undefined,
    previousScore: row.previous_score === undefined ? undefined : toNumber(row.previous_score),
    scoreDelta: row.score_delta === undefined ? undefined : toNumber(row.score_delta),
    riskDelta: row.risk_delta === undefined ? undefined : toNumber(row.risk_delta)
  };
}

function eventMatches(event: DetectionEvent, filters: DetectionEventFilters) {
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    const haystack = [
      event.eventType,
      event.summary,
      event.token.name,
      event.token.ticker,
      event.token.address,
      event.token.chain,
      event.token.pairAddress
    ].join(' ').toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.chain && filters.chain !== 'all' && event.token.chain.toLowerCase() !== filters.chain.toLowerCase()) return false;
  if (filters.severity && filters.severity !== 'all' && event.severity !== filters.severity) return false;
  if (filters.sentiment && filters.sentiment !== 'all' && event.sentiment !== filters.sentiment) return false;
  return true;
}

function severityRank(severity: DetectionSeverity) {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function tokenLogoFromSnapshot(snapshot: TokenSnapshot) {
  const raw = snapshot.raw as { logo?: string | null; overview?: { logo?: string | null }; pair?: { info?: { imageUrl?: string | null } } } | null;
  return raw?.logo || raw?.pair?.info?.imageUrl || raw?.overview?.logo || null;
}

export class DetectionStore {
  private useLocalOnly = false;
  private lastRetentionAt = 0;

  private async pruneSupabaseHistory() {
    if (this.useLocalOnly) return;
    const now = Date.now();
    if (now - this.lastRetentionAt < HISTORY_RETENTION_INTERVAL_MS) return;
    this.lastRetentionAt = now;

    const cutoff = new Date(now - getHistoryRetentionHours() * 60 * 60 * 1000).toISOString();
    await Promise.all(INTERNAL_HISTORY_TABLES.map(async (table) => {
      const params = new URLSearchParams({ timestamp: `lt.${cutoff}` });
      try {
        await supabaseFetch(`${table}?${params.toString()}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' }
        });
      } catch {
        // Retention is best-effort so scan writes do not fail if cleanup is temporarily unavailable.
      }
    }));
  }

  async getRecentSnapshots(tokenId: string, limit: number): Promise<TokenSnapshot[]> {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: SNAPSHOT_COLUMNS,
          token_id: `eq.${tokenId}`,
          order: 'timestamp.desc',
          limit: String(limit)
        });
        const rows = await supabaseFetch<any[]>(`detection_snapshots?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(snapshotFromRow) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return (readLocalState().snapshots[tokenId] || []).slice(-limit).reverse();
  }

  async getLatestClassification(tokenId: string): Promise<FinalClassification | null> {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: CLASSIFICATION_COLUMNS,
          token_id: `eq.${tokenId}`,
          order: 'timestamp.desc',
          limit: '1'
        });
        let rows: any[];
        try {
          rows = await supabaseFetch<any[]>(`detection_classifications?${params.toString()}`);
        } catch {
          params.set('select', CLASSIFICATION_BASE_COLUMNS);
          rows = await supabaseFetch<any[]>(`detection_classifications?${params.toString()}`);
        }
        return Array.isArray(rows) && rows[0] ? classificationFromRow(rows[0]) : null;
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().classifications[tokenId]?.at(-1) || null;
  }

  async getLatestClassificationSummary(tokenId: string): Promise<StoredClassification | null> {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: CLASSIFICATION_SUMMARY_COLUMNS,
          token_id: `eq.${tokenId}`,
          order: 'timestamp.desc',
          limit: '1'
        });
        const rows = await supabaseFetch<any[]>(`detection_classifications?${params.toString()}`);
        return Array.isArray(rows) && rows[0] ? classificationFromRow(rows[0]) : null;
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().classifications[tokenId]?.at(-1) || null;
  }

  async upsertToken(token: Token, snapshot?: TokenSnapshot, schedule?: TokenSchedulePatch): Promise<void> {
    const logo = snapshot ? tokenLogoFromSnapshot(snapshot) : null;
    const raw = snapshot?.raw as { overview?: { event?: string; volume24hUsd?: number; liquidityUsd?: number } } | undefined;
    const row = {
      token_id: token.tokenId,
      token_name: token.tokenName,
      token_symbol: token.tokenSymbol,
      token_address: token.tokenAddress,
      chain: token.chain,
      pair_address: token.pairAddress,
      dex_id: token.dexId,
      pair_url: token.pairUrl,
      logo_url: logo,
      overview_event: raw?.overview?.event || null,
      overview_volume_24h: raw?.overview?.volume24hUsd || null,
      overview_liquidity: raw?.overview?.liquidityUsd || null,
      last_detection_checked_at: new Date().toISOString(),
      ...(schedule ? {
        scan_tier: schedule.scanTier,
        next_detection_check_at: schedule.nextDetectionCheckAt,
        detection_priority_score: schedule.detectionPriorityScore,
        failed_hydration_count: schedule.failedHydrationCount || 0,
        last_primary_label: schedule.lastPrimaryLabel || null,
        last_risk_level: schedule.lastRiskLevel || null,
        last_event_status: schedule.lastEventStatus || null,
        consecutive_quiet_count: schedule.consecutiveQuietCount || 0
      } : {})
    };

    if (!this.useLocalOnly) {
      try {
        await supabaseFetch(`detection_tokens?on_conflict=token_id`, {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(row)
        });
        return;
      } catch {
        if (schedule) {
          try {
            const baseRow = {
              token_id: row.token_id,
              token_name: row.token_name,
              token_symbol: row.token_symbol,
              token_address: row.token_address,
              chain: row.chain,
              pair_address: row.pair_address,
              dex_id: row.dex_id,
              pair_url: row.pair_url,
              logo_url: row.logo_url,
              overview_event: row.overview_event,
              overview_volume_24h: row.overview_volume_24h,
              overview_liquidity: row.overview_liquidity,
              last_detection_checked_at: row.last_detection_checked_at
            };
            await supabaseFetch(`detection_tokens?on_conflict=token_id`, {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates' },
              body: JSON.stringify(baseRow)
            });
            return;
          } catch {
            this.useLocalOnly = true;
          }
        } else {
          this.useLocalOnly = true;
        }
      }
    }

    const state = readLocalState();
    state.tokens[token.tokenId] = {
      ...token,
      logo,
      overviewEvent: row.overview_event,
      overviewVolume24h: row.overview_volume_24h,
      overviewLiquidity: row.overview_liquidity,
      lastDetectionCheckedAt: row.last_detection_checked_at,
      scanTier: schedule?.scanTier || state.tokens[token.tokenId]?.scanTier || null,
      nextDetectionCheckAt: schedule?.nextDetectionCheckAt || state.tokens[token.tokenId]?.nextDetectionCheckAt || null,
      detectionPriorityScore: schedule?.detectionPriorityScore ?? state.tokens[token.tokenId]?.detectionPriorityScore ?? null,
      failedHydrationCount: schedule?.failedHydrationCount ?? state.tokens[token.tokenId]?.failedHydrationCount ?? 0,
      lastPrimaryLabel: schedule?.lastPrimaryLabel ?? state.tokens[token.tokenId]?.lastPrimaryLabel ?? null,
      lastRiskLevel: schedule?.lastRiskLevel ?? state.tokens[token.tokenId]?.lastRiskLevel ?? null,
      lastEventStatus: schedule?.lastEventStatus ?? state.tokens[token.tokenId]?.lastEventStatus ?? null,
      consecutiveQuietCount: schedule?.consecutiveQuietCount ?? state.tokens[token.tokenId]?.consecutiveQuietCount ?? 0
    };
    writeLocalState(state);
  }

  async listTokenQueueState(limit = 5_000): Promise<StoredToken[]> {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: TOKEN_QUEUE_COLUMNS,
          limit: String(limit)
        });
        const rows = await supabaseFetch<any[]>(`detection_tokens?${params.toString()}`);
        return Array.isArray(rows) ? rows.map(tokenFromRow) : [];
      } catch {
        return [];
      }
    }

    return Object.values(readLocalState().tokens).slice(0, limit);
  }

  async saveSnapshot(snapshot: TokenSnapshot): Promise<void> {
    const row = {
      token_id: snapshot.tokenId,
      timestamp: snapshot.timestamp,
      price_usd: snapshot.priceUsd,
      market_cap: snapshot.marketCap,
      liquidity_usd: snapshot.liquidityUsd,
      volume_5m: snapshot.volume5m,
      volume_1h: snapshot.volume1h,
      volume_6h: snapshot.volume6h,
      volume_24h: snapshot.volume24h,
      buys_5m: snapshot.buys5m,
      sells_5m: snapshot.sells5m,
      traders_5m: snapshot.traders5m,
      price_change_5m: snapshot.priceChange5m,
      price_change_1h: snapshot.priceChange1h,
      price_change_6h: snapshot.priceChange6h,
      price_change_24h: snapshot.priceChange24h,
      raw: snapshot.raw
    };

    if (!this.useLocalOnly) {
      try {
        await supabaseFetch('detection_snapshots', { method: 'POST', body: JSON.stringify(row) });
        return;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.snapshots[snapshot.tokenId] ??= [];
    state.snapshots[snapshot.tokenId].push(snapshot);
    state.snapshots[snapshot.tokenId] = state.snapshots[snapshot.tokenId].slice(-288);
    writeLocalState(state);
  }

  async saveFeatures(features: TokenFeatures): Promise<void> {
    const row = {
      token_id: features.tokenId,
      timestamp: features.timestamp,
      total_txns_5m: features.totalTxns5m,
      buy_sell_ratio: features.buySellRatio,
      buy_txn_dominance: features.buyTxnDominance,
      sell_txn_dominance: features.sellTxnDominance,
      net_txn_pressure: features.netTxnPressure,
      liquidity_change_percentage: features.liquidityChangePercentage,
      liquidity_change_usd: features.liquidityChangeUsd,
      volume_to_liquidity_ratio: features.volumeToLiquidityRatio,
      volume_spike_score: features.volumeSpikeScore,
      volume_spike_persisted_snapshots: features.volumeSpikePersistedSnapshots,
      volume_quality_score: features.volumeQualityScore,
      volume_quality_level: features.volumeQualityLevel,
      liquidity_regime: features.liquidityRegime,
      price_momentum_score: features.priceMomentumScore,
      volatility_score: features.volatilityScore,
      consecutive_green_snapshots: features.consecutiveGreenSnapshots,
      consecutive_red_snapshots: features.consecutiveRedSnapshots,
      consecutive_buy_dominant_snapshots: features.consecutiveBuyDominantSnapshots,
      consecutive_sell_dominant_snapshots: features.consecutiveSellDominantSnapshots,
      trend_direction: features.trendDirection,
      liquidity_state: features.liquidityState,
      pressure_state: features.pressureState
    };

    if (!this.useLocalOnly) {
      try {
        await supabaseFetch('detection_features', { method: 'POST', body: JSON.stringify(row) });
        return;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.features[features.tokenId] ??= [];
    state.features[features.tokenId].push(features);
    state.features[features.tokenId] = state.features[features.tokenId].slice(-288);
    writeLocalState(state);
  }

  async saveClassification(classification: FinalClassification): Promise<string> {
    const classificationId = randomUUID();
    const row = {
      classification_id: classificationId,
      token_id: classification.tokenId,
      timestamp: classification.timestamp,
      rule_label: classification.ruleLabel,
      rule_confidence: classification.ruleConfidence,
      final_label: classification.finalLabel,
      final_confidence: classification.finalConfidence,
      risk_level: classification.riskLevel,
      reason: classification.reason,
      primary_label: classification.primaryLabel,
      display_label: classification.displayLabel,
      market_phase: classification.marketPhase,
      structural_regime: classification.structuralRegime,
      active_regime: classification.activeRegime,
      dominant_timeframe: classification.dominantTimeframe,
      dominant_reason: classification.dominantReason,
      event_horizon: classification.eventHorizon,
      confirmation_status: classification.confirmationStatus,
      confirmation_score: classification.confirmationScore,
      classification_basis: classification.classificationBasis,
      lower_timeframe_trigger: classification.lowerTimeframeTrigger,
      timeframe_alignment: classification.timeframeAlignment,
      trend_change: classification.trendChange,
      event_status: classification.eventStatus,
      confidence_breakdown: classification.confidence,
      risk: classification.risk,
      manipulation_risk: classification.manipulationRisk,
      timeframe_scores: classification.timeframes,
      liquidity_regime: classification.liquidityRegime,
      volume_quality: classification.volumeQuality,
      alert_priority: classification.alertPriority,
      secondary_signals: classification.secondarySignals,
      contradictory_signals: classification.contradictorySignals,
      warnings: classification.warnings,
      evidence: classification.evidence,
      detector_scores: classification.detectorScores,
      data_quality: classification.dataQuality,
      rule_version: classification.ruleVersion,
      token_age_minutes: classification.tokenAgeMinutes ?? null,
      regime_weights: classification.regimeWeights || null,
      pair_reliability: classification.pairReliability || null
    };

    if (!this.useLocalOnly) {
      try {
        await supabaseFetch('detection_classifications', { method: 'POST', body: JSON.stringify(row) });
        await this.pruneSupabaseHistory();
        return classificationId;
      } catch {
        try {
          const baseRow = {
            classification_id: row.classification_id,
            token_id: row.token_id,
            timestamp: row.timestamp,
            rule_label: row.rule_label,
            rule_confidence: row.rule_confidence,
            final_label: row.final_label,
            final_confidence: row.final_confidence,
            risk_level: row.risk_level,
            reason: row.reason,
            primary_label: row.primary_label,
            display_label: row.display_label,
            market_phase: row.market_phase,
            structural_regime: row.structural_regime,
            active_regime: row.active_regime,
            dominant_timeframe: row.dominant_timeframe,
            dominant_reason: row.dominant_reason,
            lower_timeframe_trigger: row.lower_timeframe_trigger,
            timeframe_alignment: row.timeframe_alignment,
            trend_change: row.trend_change,
            event_status: row.event_status,
            confidence_breakdown: row.confidence_breakdown,
            risk: row.risk,
            manipulation_risk: row.manipulation_risk,
            timeframe_scores: row.timeframe_scores,
            liquidity_regime: row.liquidity_regime,
            volume_quality: row.volume_quality,
            alert_priority: row.alert_priority,
            secondary_signals: row.secondary_signals,
            contradictory_signals: row.contradictory_signals,
            warnings: row.warnings,
            evidence: row.evidence,
            detector_scores: row.detector_scores,
            data_quality: row.data_quality,
            rule_version: row.rule_version
          };
          await supabaseFetch('detection_classifications', { method: 'POST', body: JSON.stringify(baseRow) });
          await this.pruneSupabaseHistory();
          return classificationId;
        } catch {
          this.useLocalOnly = true;
        }
      }
    }

    const state = readLocalState();
    state.classifications[classification.tokenId] ??= [];
    state.classifications[classification.tokenId].push({ ...classification, classificationId });
    state.classifications[classification.tokenId] = state.classifications[classification.tokenId].slice(-288);
    writeLocalState(state);
    return classificationId;
  }

  async saveAlert(): Promise<boolean> {
    return false;
  }

  async saveEvent(event: DetectionEvent, tokenId: string) {
    const row = {
      id: event.id,
      token_id: tokenId,
      classification_id: event.classificationId,
      event_type: event.eventType,
      summary: event.summary,
      sentiment: event.sentiment,
      severity: event.severity,
      score: event.score,
      detected_at: new Date(event.detectedAt).toISOString(),
      token: event.token,
      metrics: event.metrics,
      dedupe_key: event.dedupeKey,
      lifecycle_id: event.lifecycleId || event.dedupeKey,
      lifecycle_status: event.lifecycleStatus || null,
      event_version: event.eventVersion || 1,
      last_updated_at: new Date(event.lastUpdatedAt || event.detectedAt).toISOString(),
      previous_score: event.previousScore ?? null,
      score_delta: event.scoreDelta ?? null,
      risk_delta: event.riskDelta ?? null
    };

    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: EVENT_COLUMNS,
          dedupe_key: `eq.${event.dedupeKey}`,
          limit: '1'
        });
        let existingRows: any[];
        try {
          existingRows = await supabaseFetch<any[]>(`detection_events?${params.toString()}`);
        } catch {
          params.set('select', EVENT_BASE_COLUMNS);
          existingRows = await supabaseFetch<any[]>(`detection_events?${params.toString()}`);
        }
        const existing = Array.isArray(existingRows) && existingRows[0] ? eventFromRow(existingRows[0]) : null;
        if (existing) {
          const update = {
            classification_id: row.classification_id,
            event_type: row.event_type,
            summary: row.summary,
            sentiment: row.sentiment,
            severity: row.severity,
            score: row.score,
            detected_at: row.detected_at,
            token: row.token,
            metrics: row.metrics,
            lifecycle_status: row.lifecycle_status,
            event_version: (existing.eventVersion || 1) + 1,
            last_updated_at: row.last_updated_at,
            previous_score: existing.score,
            score_delta: row.score - existing.score,
            risk_delta: severityRank(row.severity) - severityRank(existing.severity)
          };
          await supabaseFetch(`detection_events?id=eq.${existing.id}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(update)
          });
          return false;
        }

        await supabaseFetch('detection_events', {
          method: 'POST',
          body: JSON.stringify(row)
        });
        return true;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const existingIndex = state.events.findIndex((existing) => existing.dedupeKey === event.dedupeKey);
    if (existingIndex >= 0) {
      const existing = state.events[existingIndex];
      state.events.splice(existingIndex, 1);
      state.events.unshift({
        ...event,
        id: existing.id,
        eventVersion: (existing.eventVersion || 1) + 1,
        previousScore: existing.score,
        scoreDelta: event.score - existing.score,
        riskDelta: severityRank(event.severity) - severityRank(existing.severity),
        lastUpdatedAt: event.lastUpdatedAt || event.detectedAt
      });
      state.events = state.events.slice(0, 500);
      writeLocalState(state);
      return false;
    }
    state.events.unshift(event);
    state.events = state.events.slice(0, 500);
    writeLocalState(state);
    return true;
  }

  async listEvents(filters: DetectionEventFilters = {}): Promise<DetectionEventsResponse> {
    const limit = Math.max(1, Math.min(250, Number(filters.limit || 100)));
    let events: DetectionEvent[] = [];

    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: EVENT_COLUMNS,
          order: 'detected_at.desc',
          limit: String(Math.max(limit, filters.q ? 200 : limit))
        });
        if (filters.chain && filters.chain !== 'all') params.set('token->>chain', `eq.${filters.chain}`);
        if (filters.severity && filters.severity !== 'all') params.set('severity', `eq.${filters.severity}`);
        if (filters.sentiment && filters.sentiment !== 'all') params.set('sentiment', `eq.${filters.sentiment}`);
        let rows: any[];
        try {
          rows = await supabaseFetch<any[]>(`detection_events?${params.toString()}`);
        } catch {
          params.set('select', EVENT_BASE_COLUMNS);
          rows = await supabaseFetch<any[]>(`detection_events?${params.toString()}`);
        }
        events = Array.isArray(rows) ? rows.map(eventFromRow) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    if (this.useLocalOnly) {
      events = readLocalState().events.sort((left, right) => right.detectedAt - left.detectedAt);
    }

    return {
      generatedAt: new Date().toISOString(),
      events: events.filter((event) => eventMatches(event, filters)).slice(0, limit)
    };
  }

  async listTokenEvents(address: string, limit = 100): Promise<DetectionEvent[]> {
    const normalizedAddress = address.trim().toLowerCase();
    const boundedLimit = Math.max(1, Math.min(250, Number(limit || 100)));
    if (!normalizedAddress) return [];

    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: EVENT_COLUMNS,
          'token->>address': `eq.${address}`,
          order: 'detected_at.desc',
          limit: String(boundedLimit)
        });
        let rows: any[];
        try {
          rows = await supabaseFetch<any[]>(`detection_events?${params.toString()}`);
        } catch {
          params.set('select', EVENT_BASE_COLUMNS);
          rows = await supabaseFetch<any[]>(`detection_events?${params.toString()}`);
        }
        return Array.isArray(rows) ? rows.map(eventFromRow) : [];
      } catch {
        this.useLocalOnly = true;
      }
    }

    return readLocalState().events
      .filter((event) => event.token.address.toLowerCase() === normalizedAddress)
      .sort((left, right) => right.detectedAt - left.detectedAt)
      .slice(0, boundedLimit);
  }

  async getTokenDetail(chain: string, address: string, pairAddress = ''): Promise<DetectionTokenDetailResponse> {
    const normalizedChain = chain.trim().toLowerCase();
    const normalizedAddress = address.trim().toLowerCase();
    const normalizedPair = pairAddress.trim().toLowerCase();

    if (!this.useLocalOnly) {
      try {
        const tokenParams = new URLSearchParams({
          select: TOKEN_COLUMNS,
          chain: `eq.${normalizedChain}`,
          token_address: `eq.${address}`,
          limit: '1'
        });
        if (normalizedPair) tokenParams.set('pair_address', `eq.${pairAddress}`);
        const tokenRows = await supabaseFetch<any[]>(`detection_tokens?${tokenParams.toString()}`);
        const token = Array.isArray(tokenRows) && tokenRows[0] ? tokenFromRow(tokenRows[0]) : null;
        if (!token) return emptyDetail();

        const [latestClassification, events] = await Promise.all([
          this.getLatestClassificationSummary(token.tokenId),
          this.listTokenEvents(token.tokenAddress, 100)
        ]);

        return {
          generatedAt: new Date().toISOString(),
          token,
          latestSnapshot: null,
          latestFeatures: null,
          latestClassification,
          events: events.filter((event) => event.token.address.toLowerCase() === normalizedAddress || event.token.pairAddress.toLowerCase() === normalizedPair),
          snapshotHistory: [],
          classificationHistory: []
        };
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const token = Object.values(state.tokens).find((candidate) => {
      const addressMatches = candidate.tokenAddress.toLowerCase() === normalizedAddress;
      const chainMatches = candidate.chain.toLowerCase() === normalizedChain;
      const pairMatches = !normalizedPair || candidate.pairAddress.toLowerCase() === normalizedPair;
      return addressMatches && chainMatches && pairMatches;
    }) || null;
    if (!token) return emptyDetail();

    const latestClassification = state.classifications[token.tokenId]?.at(-1) || null;
    return {
      generatedAt: new Date().toISOString(),
      token,
      latestSnapshot: null,
      latestFeatures: null,
      latestClassification,
      events: state.events.filter((event) => event.token.address.toLowerCase() === normalizedAddress).slice(0, 100),
      snapshotHistory: [],
      classificationHistory: []
    };
  }

  async getRecentFeatures(tokenId: string, limit: number): Promise<TokenFeatures[]> {
    if (!this.useLocalOnly) {
      const params = new URLSearchParams({
        select: FEATURE_COLUMNS,
        token_id: `eq.${tokenId}`,
        order: 'timestamp.desc',
        limit: String(limit)
      });
      const rows = await supabaseFetch<any[]>(`detection_features?${params.toString()}`);
      return Array.isArray(rows) ? rows.map(featureFromRow) : [];
    }
    return (readLocalState().features[tokenId] || []).slice(-limit).reverse();
  }

  async getRecentClassifications(tokenId: string, limit: number): Promise<StoredClassification[]> {
    if (!this.useLocalOnly) {
      const params = new URLSearchParams({
        select: CLASSIFICATION_COLUMNS,
        token_id: `eq.${tokenId}`,
        order: 'timestamp.desc',
        limit: String(limit)
      });
      let rows: any[];
      try {
        rows = await supabaseFetch<any[]>(`detection_classifications?${params.toString()}`);
      } catch {
        params.set('select', CLASSIFICATION_BASE_COLUMNS);
        rows = await supabaseFetch<any[]>(`detection_classifications?${params.toString()}`);
      }
      return Array.isArray(rows) ? rows.map(classificationFromRow) : [];
    }
    return (readLocalState().classifications[tokenId] || []).slice(-limit).reverse();
  }

  async saveRun(patch: DetectionRunPatch) {
    const id = patch.id || randomUUID();
    const row = {
      id,
      started_at: patch.startedAt,
      completed_at: patch.completedAt || null,
      status: patch.status,
      scanned_count: patch.scannedCount || 0,
      classified_count: patch.classifiedCount || 0,
      failed_count: patch.failedCount || 0,
      event_count: patch.eventCount || 0,
      error: patch.error || null
    };

    if (!this.useLocalOnly) {
      try {
        await supabaseFetch('detection_runs?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(row)
        });
        return id;
      } catch {
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const existing = state.runs.findIndex((run) => run.id === id);
    const nextRun = { ...patch, id };
    if (existing >= 0) state.runs[existing] = nextRun;
    else state.runs.unshift(nextRun);
    state.runs = state.runs.slice(0, 100);
    writeLocalState(state);
    return id;
  }
}

function emptyDetail(): DetectionTokenDetailResponse {
  return {
    generatedAt: new Date().toISOString(),
    token: null,
    latestSnapshot: null,
    latestFeatures: null,
    latestClassification: null,
    events: [],
    snapshotHistory: [],
    classificationHistory: []
  };
}
