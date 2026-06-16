import { outcomeScoringEnabled } from './config';
import { DetectionResearchStore, type OutcomeRow, type ResearchSetupRow, type ResearchSnapshotRow } from './store';

const HORIZONS = [
  ['15m', 15],
  ['1h', 60],
  ['3h', 180],
  ['6h', 360],
  ['12h', 720],
  ['24h', 1_440]
] as const;

type HorizonKey = typeof HORIZONS[number][0];

export type OutcomeScoringResult = {
  scanned: number;
  scored: number;
  skipped: number;
};

export class DetectionOutcomeScorer {
  constructor(private readonly store = new DetectionResearchStore()) {}

  async run(limit = 250, now = Date.now()): Promise<OutcomeScoringResult> {
    if (!outcomeScoringEnabled()) return { scanned: 0, scored: 0, skipped: 0 };

    const setups = await this.store.listRecentSetups(limit);
    let scored = 0;
    let skipped = 0;

    for (const setup of setups) {
      const existing = await this.store.getOutcome(setup.event_id).catch(() => null);
      if (existing?.outcome_status === 'complete') {
        skipped += 1;
        continue;
      }

      const outcome = await this.scoreSetup(setup, now);
      if (!outcome) {
        skipped += 1;
        continue;
      }
      await this.store.saveOutcome(outcome);
      scored += 1;
    }

    return { scanned: setups.length, scored, skipped };
  }

  async scoreSetup(setup: ResearchSetupRow, now = Date.now()): Promise<OutcomeRow | null> {
    const alertTime = Date.parse(setup.alert_timestamp);
    if (!setup.price_usd || !Number.isFinite(alertTime)) return null;

    const snapshots = await this.store.listSnapshotsAfter(setup.token_id, setup.alert_timestamp);
    const usable = snapshots.filter((snapshot) => snapshot.price_usd !== null && Number.isFinite(Date.parse(snapshot.timestamp)));
    if (!usable.length) return baseOutcome(setup, 'unresolved', 'No future snapshots were available for this event.');

    const horizonSnapshots = new Map<HorizonKey, ResearchSnapshotRow>();
    for (const [key, minutes] of HORIZONS) {
      const target = alertTime + minutes * 60_000;
      const snapshot = closestAfter(usable, target, 20 * 60_000);
      if (snapshot) horizonSnapshots.set(key, snapshot);
    }

    const windowEnd = Math.min(now, alertTime + 1_440 * 60_000);
    const windowSnapshots = usable.filter((snapshot) => {
      const timestamp = Date.parse(snapshot.timestamp);
      return timestamp >= alertTime && timestamp <= windowEnd;
    });
    const extrema = getExtrema(setup, windowSnapshots);
    const complete = now >= alertTime + 1_440 * 60_000 && horizonSnapshots.has('24h');
    const hasAnyHorizon = horizonSnapshots.size > 0;
    const status: OutcomeRow['outcome_status'] = complete ? 'complete' : hasAnyHorizon ? 'partial' : 'pending';

    return {
      ...baseOutcome(setup, status, null),
      price_15m: priceFor(horizonSnapshots, '15m'),
      price_1h: priceFor(horizonSnapshots, '1h'),
      price_3h: priceFor(horizonSnapshots, '3h'),
      price_6h: priceFor(horizonSnapshots, '6h'),
      price_12h: priceFor(horizonSnapshots, '12h'),
      price_24h: priceFor(horizonSnapshots, '24h'),
      return_15m_bps: returnFor(setup.price_usd, horizonSnapshots, '15m'),
      return_1h_bps: returnFor(setup.price_usd, horizonSnapshots, '1h'),
      return_3h_bps: returnFor(setup.price_usd, horizonSnapshots, '3h'),
      return_6h_bps: returnFor(setup.price_usd, horizonSnapshots, '6h'),
      return_12h_bps: returnFor(setup.price_usd, horizonSnapshots, '12h'),
      return_24h_bps: returnFor(setup.price_usd, horizonSnapshots, '24h'),
      liquidity_15m: liquidityFor(horizonSnapshots, '15m'),
      liquidity_1h: liquidityFor(horizonSnapshots, '1h'),
      liquidity_3h: liquidityFor(horizonSnapshots, '3h'),
      liquidity_6h: liquidityFor(horizonSnapshots, '6h'),
      liquidity_12h: liquidityFor(horizonSnapshots, '12h'),
      liquidity_24h: liquidityFor(horizonSnapshots, '24h'),
      liquidity_change_1h_bps: setup.liquidity_usd ? liquidityReturnFor(setup.liquidity_usd, horizonSnapshots, '1h') : null,
      liquidity_change_6h_bps: setup.liquidity_usd ? liquidityReturnFor(setup.liquidity_usd, horizonSnapshots, '6h') : null,
      liquidity_change_24h_bps: setup.liquidity_usd ? liquidityReturnFor(setup.liquidity_usd, horizonSnapshots, '24h') : null,
      max_upside_24h_bps: extrema.maxUpsideBps,
      max_drawdown_24h_bps: extrema.maxDrawdownBps,
      time_to_max_upside_minutes: extrema.timeToMaxUpsideMinutes,
      time_to_max_drawdown_minutes: extrema.timeToMaxDrawdownMinutes,
      target_hit: extrema.maxUpsideBps !== null ? extrema.maxUpsideBps >= 500 : null,
      invalidation_hit: extrema.maxDrawdownBps !== null ? extrema.maxDrawdownBps <= -500 : null,
      result: resultFor(setup, returnFor(setup.price_usd, horizonSnapshots, preferredHorizon(setup)), extrema.maxDrawdownBps)
    };
  }
}

function baseOutcome(setup: ResearchSetupRow, status: OutcomeRow['outcome_status'], notes: string | null): OutcomeRow {
  const now = new Date().toISOString();
  return {
    event_id: setup.event_id,
    token_id: setup.token_id,
    scored_at: now,
    outcome_status: status,
    alert_price_usd: setup.price_usd,
    alert_liquidity_usd: setup.liquidity_usd,
    price_15m: null,
    price_1h: null,
    price_3h: null,
    price_6h: null,
    price_12h: null,
    price_24h: null,
    return_15m_bps: null,
    return_1h_bps: null,
    return_3h_bps: null,
    return_6h_bps: null,
    return_12h_bps: null,
    return_24h_bps: null,
    liquidity_15m: null,
    liquidity_1h: null,
    liquidity_3h: null,
    liquidity_6h: null,
    liquidity_12h: null,
    liquidity_24h: null,
    liquidity_change_1h_bps: null,
    liquidity_change_6h_bps: null,
    liquidity_change_24h_bps: null,
    max_upside_24h_bps: null,
    max_drawdown_24h_bps: null,
    time_to_max_upside_minutes: null,
    time_to_max_drawdown_minutes: null,
    target_hit: null,
    invalidation_hit: null,
    result: status === 'unresolved' ? 'unresolved' : null,
    notes,
    updated_at: now
  };
}

function closestAfter(snapshots: ResearchSnapshotRow[], target: number, toleranceMs: number) {
  let best: ResearchSnapshotRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const snapshot of snapshots) {
    const timestamp = Date.parse(snapshot.timestamp);
    if (timestamp < target) continue;
    const distance = Math.abs(timestamp - target);
    if (distance <= toleranceMs && distance < bestDistance) {
      best = snapshot;
      bestDistance = distance;
    }
  }
  return best;
}

function priceFor(snapshots: Map<HorizonKey, ResearchSnapshotRow>, horizon: HorizonKey) {
  return snapshots.get(horizon)?.price_usd ?? null;
}

function liquidityFor(snapshots: Map<HorizonKey, ResearchSnapshotRow>, horizon: HorizonKey) {
  return snapshots.get(horizon)?.liquidity_usd ?? null;
}

function bpsChange(start: number | null, end: number | null) {
  if (!start || end === null) return null;
  return Math.round(((end - start) / start) * 10_000);
}

function returnFor(startPrice: number, snapshots: Map<HorizonKey, ResearchSnapshotRow>, horizon: HorizonKey) {
  return bpsChange(startPrice, snapshots.get(horizon)?.price_usd ?? null);
}

function liquidityReturnFor(startLiquidity: number, snapshots: Map<HorizonKey, ResearchSnapshotRow>, horizon: HorizonKey) {
  return bpsChange(startLiquidity, snapshots.get(horizon)?.liquidity_usd ?? null);
}

function getExtrema(setup: ResearchSetupRow, snapshots: ResearchSnapshotRow[]) {
  if (!setup.price_usd || !snapshots.length) {
    return { maxUpsideBps: null, maxDrawdownBps: null, timeToMaxUpsideMinutes: null, timeToMaxDrawdownMinutes: null };
  }

  const alertTime = Date.parse(setup.alert_timestamp);
  let maxUpsideBps: number | null = null;
  let maxDrawdownBps: number | null = null;
  let timeToMaxUpsideMinutes: number | null = null;
  let timeToMaxDrawdownMinutes: number | null = null;

  for (const snapshot of snapshots) {
    const move = bpsChange(setup.price_usd, snapshot.price_usd);
    const timestamp = Date.parse(snapshot.timestamp);
    if (move === null || !Number.isFinite(timestamp)) continue;
    const minutes = Math.max(0, Math.round((timestamp - alertTime) / 60_000));
    if (maxUpsideBps === null || move > maxUpsideBps) {
      maxUpsideBps = move;
      timeToMaxUpsideMinutes = minutes;
    }
    if (maxDrawdownBps === null || move < maxDrawdownBps) {
      maxDrawdownBps = move;
      timeToMaxDrawdownMinutes = minutes;
    }
  }

  return { maxUpsideBps, maxDrawdownBps, timeToMaxUpsideMinutes, timeToMaxDrawdownMinutes };
}

function preferredHorizon(setup: ResearchSetupRow): HorizonKey {
  if (setup.event_label === 'ACCUMULATION' || setup.event_label === 'DISTRIBUTION') return '6h';
  if (setup.event_label.includes('LIQUIDITY') || setup.event_label.includes('LOW_LIQUIDITY')) return '1h';
  if (setup.event_label.includes('BREAKOUT') || setup.event_label.includes('BREAKDOWN')) return '1h';
  return '3h';
}

function resultFor(setup: ResearchSetupRow, preferredReturnBps: number | null, maxDrawdownBps: number | null): OutcomeRow['result'] {
  if (preferredReturnBps === null) return 'unresolved';
  const bearish = setup.event_label.includes('DISTRIBUTION') ||
    setup.event_label.includes('DUMP') ||
    setup.event_label.includes('SELL') ||
    setup.event_label.includes('DRAIN') ||
    setup.event_label.includes('BREAKDOWN');
  const directionalReturn = bearish ? -preferredReturnBps : preferredReturnBps;
  if (directionalReturn >= 500 && (maxDrawdownBps === null || maxDrawdownBps > -1_000)) return 'win';
  if (directionalReturn <= -500) return 'loss';
  return 'neutral';
}
