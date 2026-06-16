import { readEnv } from '../env';

export type ResearchSetupRow = {
  event_id: string;
  classification_id: string | null;
  token_id: string;
  token_address: string;
  pair_address: string;
  chain: string;
  dex_id: string | null;
  event_label: string;
  alert_timestamp: string;
  rule_version: string | null;
  confidence: number | null;
  risk_level: string | null;
  risk_score: number | null;
  manipulation_risk_level: string | null;
  manipulation_risk_score: number | null;
  alert_priority: string | null;
  confirmation_status: string | null;
  confirmation_score: number | null;
  classification_basis: string | null;
  event_horizon: string | null;
  dominant_timeframe: string | null;
  structural_regime: string | null;
  active_regime: string | null;
  lower_timeframe_trigger: string | null;
  trend_change: string | null;
  price_usd: number | null;
  market_cap: number | null;
  liquidity_usd: number | null;
  volume_5m: number | null;
  volume_1h: number | null;
  volume_6h: number | null;
  volume_24h: number | null;
  buys_5m: number | null;
  sells_5m: number | null;
  traders_5m: number | null;
  price_change_5m: number | null;
  price_change_1h: number | null;
  price_change_6h: number | null;
  price_change_24h: number | null;
  total_txns_5m: number | null;
  buy_sell_ratio: number | null;
  buy_txn_dominance: number | null;
  sell_txn_dominance: number | null;
  net_txn_pressure: number | null;
  liquidity_change_percentage: number | null;
  liquidity_change_usd: number | null;
  volume_to_liquidity_ratio: number | null;
  volume_spike_score: number | null;
  volume_spike_persisted_snapshots: number | null;
  volume_quality_score: number | null;
  volume_quality_level: string | null;
  liquidity_regime: string | null;
  liquidity_state: string | null;
  pressure_state: string | null;
  price_momentum_score: number | null;
  volatility_score: number | null;
  consecutive_green_snapshots: number | null;
  consecutive_red_snapshots: number | null;
  consecutive_buy_dominant_snapshots: number | null;
  consecutive_sell_dominant_snapshots: number | null;
  trend_direction: string | null;
  data_quality_score: number | null;
  history_snapshots: number | null;
  pair_reliability_tier: string | null;
  pair_reliability_score: number | null;
  secondary_signals: unknown[];
  contradictory_signals: unknown[];
  warnings: unknown[];
  context_summary: Record<string, unknown>;
};

export type ResearchSnapshotRow = {
  token_id: string;
  timestamp: string;
  price_usd: number | null;
  liquidity_usd: number | null;
  volume_5m: number | null;
};

export type OutcomeRow = {
  event_id: string;
  token_id: string;
  scored_at: string;
  outcome_status: 'pending' | 'partial' | 'complete' | 'unresolved';
  alert_price_usd: number | null;
  alert_liquidity_usd: number | null;
  price_15m: number | null;
  price_1h: number | null;
  price_3h: number | null;
  price_6h: number | null;
  price_12h: number | null;
  price_24h: number | null;
  return_15m_bps: number | null;
  return_1h_bps: number | null;
  return_3h_bps: number | null;
  return_6h_bps: number | null;
  return_12h_bps: number | null;
  return_24h_bps: number | null;
  liquidity_15m: number | null;
  liquidity_1h: number | null;
  liquidity_3h: number | null;
  liquidity_6h: number | null;
  liquidity_12h: number | null;
  liquidity_24h: number | null;
  liquidity_change_1h_bps: number | null;
  liquidity_change_6h_bps: number | null;
  liquidity_change_24h_bps: number | null;
  max_upside_24h_bps: number | null;
  max_drawdown_24h_bps: number | null;
  time_to_max_upside_minutes: number | null;
  time_to_max_drawdown_minutes: number | null;
  target_hit: boolean | null;
  invalidation_hit: boolean | null;
  result: 'win' | 'loss' | 'neutral' | 'unresolved' | null;
  notes: string | null;
  updated_at: string;
};

function getSupabaseConfig() {
  return {
    url: readEnv('SUPABASE_URL').replace(/\/$/, ''),
    key: readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY')
  };
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class DetectionResearchStore {
  private async supabaseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) throw new Error('Supabase is not configured for Detection research.');

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
      throw new Error(`Supabase Detection research request failed (${response.status}). ${message}`.trim());
    }

    if (response.status === 204) return null as T;
    return response.json().catch(() => null) as T;
  }

  async saveEventSetup(row: ResearchSetupRow) {
    await this.supabaseFetch('detection_event_setups?on_conflict=event_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row)
    });
  }

  async listRecentSetups(limit = 500): Promise<ResearchSetupRow[]> {
    const params = new URLSearchParams({
      select: '*',
      order: 'alert_timestamp.desc',
      limit: String(Math.max(1, Math.min(5_000, limit)))
    });
    const rows = await this.supabaseFetch<Record<string, unknown>[]>(`detection_event_setups?${params.toString()}`);
    return Array.isArray(rows) ? rows.map(setupFromRow) : [];
  }

  async listOutcomeRows(limit = 5_000): Promise<OutcomeRow[]> {
    const params = new URLSearchParams({
      select: '*',
      order: 'scored_at.desc',
      limit: String(Math.max(1, Math.min(20_000, limit)))
    });
    const rows = await this.supabaseFetch<Record<string, unknown>[]>(`detection_event_outcomes?${params.toString()}`);
    return Array.isArray(rows) ? rows.map(outcomeFromRow) : [];
  }

  async getOutcome(eventId: string): Promise<OutcomeRow | null> {
    const params = new URLSearchParams({
      select: '*',
      event_id: `eq.${eventId}`,
      limit: '1'
    });
    const rows = await this.supabaseFetch<Record<string, unknown>[]>(`detection_event_outcomes?${params.toString()}`);
    return Array.isArray(rows) && rows[0] ? outcomeFromRow(rows[0]) : null;
  }

  async saveOutcome(row: OutcomeRow) {
    await this.supabaseFetch('detection_event_outcomes?on_conflict=event_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row)
    });
  }

  async listSnapshotsAfter(tokenId: string, startTimestamp: string, limit = 1_000): Promise<ResearchSnapshotRow[]> {
    const params = new URLSearchParams({
      select: 'token_id,timestamp,price_usd,liquidity_usd,volume_5m',
      token_id: `eq.${tokenId}`,
      timestamp: `gte.${startTimestamp}`,
      order: 'timestamp.asc',
      limit: String(Math.max(1, Math.min(5_000, limit)))
    });
    const rows = await this.supabaseFetch<Record<string, unknown>[]>(`detection_snapshots?${params.toString()}`);
    return Array.isArray(rows) ? rows.map(snapshotFromRow) : [];
  }
}

function setupFromRow(row: Record<string, unknown>): ResearchSetupRow {
  return {
    event_id: String(row.event_id || ''),
    classification_id: row.classification_id ? String(row.classification_id) : null,
    token_id: String(row.token_id || ''),
    token_address: String(row.token_address || ''),
    pair_address: String(row.pair_address || ''),
    chain: String(row.chain || ''),
    dex_id: row.dex_id ? String(row.dex_id) : null,
    event_label: String(row.event_label || ''),
    alert_timestamp: String(row.alert_timestamp || ''),
    rule_version: row.rule_version ? String(row.rule_version) : null,
    confidence: toNumber(row.confidence),
    risk_level: row.risk_level ? String(row.risk_level) : null,
    risk_score: toNumber(row.risk_score),
    manipulation_risk_level: row.manipulation_risk_level ? String(row.manipulation_risk_level) : null,
    manipulation_risk_score: toNumber(row.manipulation_risk_score),
    alert_priority: row.alert_priority ? String(row.alert_priority) : null,
    confirmation_status: row.confirmation_status ? String(row.confirmation_status) : null,
    confirmation_score: toNumber(row.confirmation_score),
    classification_basis: row.classification_basis ? String(row.classification_basis) : null,
    event_horizon: row.event_horizon ? String(row.event_horizon) : null,
    dominant_timeframe: row.dominant_timeframe ? String(row.dominant_timeframe) : null,
    structural_regime: row.structural_regime ? String(row.structural_regime) : null,
    active_regime: row.active_regime ? String(row.active_regime) : null,
    lower_timeframe_trigger: row.lower_timeframe_trigger ? String(row.lower_timeframe_trigger) : null,
    trend_change: row.trend_change ? String(row.trend_change) : null,
    price_usd: toNumber(row.price_usd),
    market_cap: toNumber(row.market_cap),
    liquidity_usd: toNumber(row.liquidity_usd),
    volume_5m: toNumber(row.volume_5m),
    volume_1h: toNumber(row.volume_1h),
    volume_6h: toNumber(row.volume_6h),
    volume_24h: toNumber(row.volume_24h),
    buys_5m: toNumber(row.buys_5m),
    sells_5m: toNumber(row.sells_5m),
    traders_5m: toNumber(row.traders_5m),
    price_change_5m: toNumber(row.price_change_5m),
    price_change_1h: toNumber(row.price_change_1h),
    price_change_6h: toNumber(row.price_change_6h),
    price_change_24h: toNumber(row.price_change_24h),
    total_txns_5m: toNumber(row.total_txns_5m),
    buy_sell_ratio: toNumber(row.buy_sell_ratio),
    buy_txn_dominance: toNumber(row.buy_txn_dominance),
    sell_txn_dominance: toNumber(row.sell_txn_dominance),
    net_txn_pressure: toNumber(row.net_txn_pressure),
    liquidity_change_percentage: toNumber(row.liquidity_change_percentage),
    liquidity_change_usd: toNumber(row.liquidity_change_usd),
    volume_to_liquidity_ratio: toNumber(row.volume_to_liquidity_ratio),
    volume_spike_score: toNumber(row.volume_spike_score),
    volume_spike_persisted_snapshots: toNumber(row.volume_spike_persisted_snapshots),
    volume_quality_score: toNumber(row.volume_quality_score),
    volume_quality_level: row.volume_quality_level ? String(row.volume_quality_level) : null,
    liquidity_regime: row.liquidity_regime ? String(row.liquidity_regime) : null,
    liquidity_state: row.liquidity_state ? String(row.liquidity_state) : null,
    pressure_state: row.pressure_state ? String(row.pressure_state) : null,
    price_momentum_score: toNumber(row.price_momentum_score),
    volatility_score: toNumber(row.volatility_score),
    consecutive_green_snapshots: toNumber(row.consecutive_green_snapshots),
    consecutive_red_snapshots: toNumber(row.consecutive_red_snapshots),
    consecutive_buy_dominant_snapshots: toNumber(row.consecutive_buy_dominant_snapshots),
    consecutive_sell_dominant_snapshots: toNumber(row.consecutive_sell_dominant_snapshots),
    trend_direction: row.trend_direction ? String(row.trend_direction) : null,
    data_quality_score: toNumber(row.data_quality_score),
    history_snapshots: toNumber(row.history_snapshots),
    pair_reliability_tier: row.pair_reliability_tier ? String(row.pair_reliability_tier) : null,
    pair_reliability_score: toNumber(row.pair_reliability_score),
    secondary_signals: Array.isArray(row.secondary_signals) ? row.secondary_signals : [],
    contradictory_signals: Array.isArray(row.contradictory_signals) ? row.contradictory_signals : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    context_summary: row.context_summary && typeof row.context_summary === 'object' && !Array.isArray(row.context_summary)
      ? row.context_summary as Record<string, unknown>
      : {}
  };
}

function outcomeFromRow(row: Record<string, unknown>): OutcomeRow {
  return {
    event_id: String(row.event_id || ''),
    token_id: String(row.token_id || ''),
    scored_at: String(row.scored_at || ''),
    outcome_status: ['pending', 'partial', 'complete', 'unresolved'].includes(String(row.outcome_status))
      ? String(row.outcome_status) as OutcomeRow['outcome_status']
      : 'pending',
    alert_price_usd: toNumber(row.alert_price_usd),
    alert_liquidity_usd: toNumber(row.alert_liquidity_usd),
    price_15m: toNumber(row.price_15m),
    price_1h: toNumber(row.price_1h),
    price_3h: toNumber(row.price_3h),
    price_6h: toNumber(row.price_6h),
    price_12h: toNumber(row.price_12h),
    price_24h: toNumber(row.price_24h),
    return_15m_bps: toNumber(row.return_15m_bps),
    return_1h_bps: toNumber(row.return_1h_bps),
    return_3h_bps: toNumber(row.return_3h_bps),
    return_6h_bps: toNumber(row.return_6h_bps),
    return_12h_bps: toNumber(row.return_12h_bps),
    return_24h_bps: toNumber(row.return_24h_bps),
    liquidity_15m: toNumber(row.liquidity_15m),
    liquidity_1h: toNumber(row.liquidity_1h),
    liquidity_3h: toNumber(row.liquidity_3h),
    liquidity_6h: toNumber(row.liquidity_6h),
    liquidity_12h: toNumber(row.liquidity_12h),
    liquidity_24h: toNumber(row.liquidity_24h),
    liquidity_change_1h_bps: toNumber(row.liquidity_change_1h_bps),
    liquidity_change_6h_bps: toNumber(row.liquidity_change_6h_bps),
    liquidity_change_24h_bps: toNumber(row.liquidity_change_24h_bps),
    max_upside_24h_bps: toNumber(row.max_upside_24h_bps),
    max_drawdown_24h_bps: toNumber(row.max_drawdown_24h_bps),
    time_to_max_upside_minutes: toNumber(row.time_to_max_upside_minutes),
    time_to_max_drawdown_minutes: toNumber(row.time_to_max_drawdown_minutes),
    target_hit: typeof row.target_hit === 'boolean' ? row.target_hit : null,
    invalidation_hit: typeof row.invalidation_hit === 'boolean' ? row.invalidation_hit : null,
    result: ['win', 'loss', 'neutral', 'unresolved'].includes(String(row.result)) ? String(row.result) as OutcomeRow['result'] : null,
    notes: row.notes ? String(row.notes) : null,
    updated_at: String(row.updated_at || '')
  };
}

function snapshotFromRow(row: Record<string, unknown>): ResearchSnapshotRow {
  return {
    token_id: String(row.token_id || ''),
    timestamp: String(row.timestamp || ''),
    price_usd: toNumber(row.price_usd),
    liquidity_usd: toNumber(row.liquidity_usd),
    volume_5m: toNumber(row.volume_5m)
  };
}
