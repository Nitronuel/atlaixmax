import { randomUUID } from 'node:crypto';
import type { OverviewToken } from '../../src/shared/overview';
import { readEnv } from '../env';
import { acquireSystemLock, releaseSystemLock } from '../locks';
import { getOverviewFeed } from '../overview/database';
import { classifyToken } from './classification';
import { buildDetectionEvent, severityScore, shouldCreateDetectionEvent } from './events';
import { calculateFeatures } from './features';
import { hydrateDetectionCandidate } from './dexscreener';
import { DetectionStore } from './store';
import { SmartAlertStore } from '../smart-alerts/store';
import type { FinalClassification, ScanTier, TokenSchedulePatch } from './types';

type DetectionRunnerStatus = {
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

const LOCK_NAME = 'detection_engine';
const LOCK_TTL_SECONDS = 8 * 60;
const DEFAULT_INTERVAL_MS = 120_000;
const DEFAULT_BATCH_SIZE = 75;
const DEFAULT_CONCURRENCY = 4;
const START_DELAY_MS = 15_000;
const QUIET_LABELS = new Set(['LOW_ACTIVITY', 'INSUFFICIENT_DATA', 'UNKNOWN', 'CONSOLIDATION']);
const TIER_INTERVAL_MS: Record<ScanTier, number> = {
  hot: 2 * 60_000,
  warm: 5 * 60_000,
  cold: 20 * 60_000,
  dormant: 60 * 60_000
};

type QueueTokenState = {
  scanTier?: ScanTier | null;
  nextDetectionCheckAt?: string | null;
  detectionPriorityScore?: number | null;
};

function readNumberEnv(key: string, fallback: number) {
  const value = Number(readEnv(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBooleanEnv(key: string, fallback: boolean) {
  const value = readEnv(key).toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function hasSupabaseLockConfig() {
  return Boolean(readEnv('SUPABASE_URL') && readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'));
}

function candidateScore(token: OverviewToken) {
  const eventBoost = token.event === 'Market Stress' ? 120
    : token.event === 'Flow Imbalance' ? 90
      : token.event === 'Momentum Breakout' ? 80
        : token.event === 'Liquidity Event' ? 70
          : 25;
  return eventBoost
    + Math.min(100, token.volume24hUsd / 100_000)
    + Math.min(80, token.liquidityUsd / 150_000)
    + Math.min(40, Math.abs(token.change24h || 0));
}

function queueKey(chain: string, address: string) {
  return `${chain.trim().toLowerCase()}:${address.trim().toLowerCase()}`;
}

function queueStateFor(candidate: OverviewToken, states: Map<string, QueueTokenState>) {
  const chain = candidate.chain.trim().toLowerCase();
  return states.get(queueKey(chain, candidate.address)) || states.get(queueKey(chain, candidate.pairAddress || '')) || null;
}

function queueTierScore(tier: ScanTier | null | undefined) {
  if (tier === 'hot') return 400;
  if (tier === 'warm') return 240;
  if (tier === 'dormant') return 20;
  return 100;
}

export function selectDetectionBatch(tokens: OverviewToken[], states: Map<string, QueueTokenState>, batchSize: number, cursor: number, now = Date.now()) {
  const candidates = tokens
    .filter((token) => token.address)
    .map((token) => {
      const state = queueStateFor(token, states);
      const nextCheckAt = state?.nextDetectionCheckAt ? Date.parse(state.nextDetectionCheckAt) : 0;
      const due = !nextCheckAt || !Number.isFinite(nextCheckAt) || nextCheckAt <= now;
      const staleMinutes = due && nextCheckAt ? Math.min(240, Math.max(0, (now - nextCheckAt) / 60_000)) : 0;
      const score = candidateScore(token);
      return {
        token,
        due,
        rank: (due ? 1_000 : 0) + queueTierScore(state?.scanTier) + (state?.detectionPriorityScore ?? score) + staleMinutes
      };
    })
    .sort((left, right) => right.rank - left.rank);

  const due = candidates.filter((candidate) => candidate.due).slice(0, batchSize);
  const selected = [...due];
  if (selected.length < batchSize) {
    const selectedIds = new Set(selected.map((candidate) => candidate.token.id));
    const fallback = candidates.filter((candidate) => !selectedIds.has(candidate.token.id));
    if (fallback.length) {
      const start = cursor % fallback.length;
      const remaining = batchSize - selected.length;
      selected.push(...[...fallback.slice(start), ...fallback.slice(0, start)].slice(0, remaining));
    }
  }

  return selected.map((candidate) => candidate.token);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await mapper(current));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function resolveScanSchedule(
  classification: FinalClassification,
  previousClassification: FinalClassification | null,
  eventCreated: boolean,
  now = Date.now()
): TokenSchedulePatch {
  const tier = resolveScanTier(classification, eventCreated);
  return {
    scanTier: tier,
    nextDetectionCheckAt: new Date(now + TIER_INTERVAL_MS[tier]).toISOString(),
    detectionPriorityScore: detectionPriorityScore(classification, eventCreated),
    failedHydrationCount: 0,
    lastPrimaryLabel: classification.primaryLabel,
    lastRiskLevel: classification.riskLevel,
    lastEventStatus: classification.eventStatus,
    consecutiveQuietCount: QUIET_LABELS.has(classification.primaryLabel)
      ? ((previousClassification && QUIET_LABELS.has(previousClassification.primaryLabel)) ? 2 : 1)
      : 0
  };
}

function resolveScanTier(classification: FinalClassification, eventCreated: boolean): ScanTier {
  if (classification.classificationBasis === 'short_term_watch') {
    return classification.confirmationStatus === 'watch' ? 'hot' : 'warm';
  }
  if (
    QUIET_LABELS.has(classification.primaryLabel) ||
    (!classification.dataQuality.hasMinimumActivity && classification.riskLevel === 'low' && classification.alertPriority === 'none')
  ) {
    return 'dormant';
  }
  if (
    eventCreated ||
    classification.riskLevel === 'critical' ||
    classification.riskLevel === 'high' ||
    classification.alertPriority === 'critical' ||
    classification.alertPriority === 'high' ||
    classification.eventStatus === 'new' ||
    classification.eventStatus === 'strengthening'
  ) {
    return 'hot';
  }
  if (
    classification.alertPriority === 'medium' ||
    classification.alertPriority === 'low' ||
    classification.riskLevel === 'medium' ||
    classification.volumeQuality.score >= 31
  ) {
    return 'warm';
  }
  return 'cold';
}

function detectionPriorityScore(classification: FinalClassification, eventCreated: boolean) {
  const riskBoost = classification.riskLevel === 'critical' ? 160
    : classification.riskLevel === 'high' ? 120
      : classification.riskLevel === 'medium' ? 70
        : 20;
  const alertBoost = classification.alertPriority === 'critical' ? 160
    : classification.alertPriority === 'high' ? 120
      : classification.alertPriority === 'medium' ? 80
        : classification.alertPriority === 'low' ? 40
          : 0;
  return Math.round(
    riskBoost +
    alertBoost +
    classification.finalConfidence +
    classification.volumeQuality.score * 0.4 +
    Math.min(100, classification.risk.score) +
    (eventCreated ? 80 : 0)
  );
}

export class DetectionRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private cursor = 0;
  private status: DetectionRunnerStatus;
  private readonly smartAlerts = new SmartAlertStore();

  constructor(private readonly store = new DetectionStore()) {
    this.status = {
      enabled: readBooleanEnv('DETECTION_ENABLED', true),
      running: false,
      lastRunStartedAt: null,
      lastRunCompletedAt: null,
      lastRunStatus: 'idle',
      lastError: '',
      intervalMs: readNumberEnv('DETECTION_INTERVAL_MS', DEFAULT_INTERVAL_MS),
      batchSize: readNumberEnv('DETECTION_BATCH_SIZE', DEFAULT_BATCH_SIZE),
      scanned: 0,
      classified: 0,
      failed: 0,
      eventsCreated: 0
    };
  }

  start() {
    if (!this.status.enabled || this.timer) return;
    this.startupTimer = setTimeout(() => void this.runNow(), readNumberEnv('DETECTION_INITIAL_DELAY_MS', START_DELAY_MS));
    this.timer = setInterval(() => void this.runNow(), this.status.intervalMs);
    console.log(`[DetectionEngine] scheduler started intervalMs=${this.status.intervalMs} batchSize=${this.status.batchSize}`);
  }

  stop() {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus() {
    return { ...this.status };
  }

  async runNow() {
    if (!this.status.enabled || this.inFlight) return this.getStatus();

    this.inFlight = true;
    this.status.running = true;
    this.status.lastRunStartedAt = new Date().toISOString();
    this.status.lastError = '';
    const runId = randomUUID();
    await this.store.saveRun({ id: runId, startedAt: this.status.lastRunStartedAt, status: 'running' });

    let locked = false;
    try {
      locked = await this.acquireLock();
      if (!locked) {
        this.status.lastRunStatus = 'skipped';
        await this.store.saveRun({
          id: runId,
          startedAt: this.status.lastRunStartedAt,
          completedAt: new Date().toISOString(),
          status: 'skipped'
        });
        console.log('[DetectionEngine] run skipped; lock is held by another process');
      } else {
        const result = await this.runCycle();
        this.status.scanned = result.scanned;
        this.status.classified = result.classified;
        this.status.failed = result.failed;
        this.status.eventsCreated = result.eventsCreated;
        this.status.lastError = result.firstError
          ? `Detection completed with ${result.failed} failed candidate${result.failed === 1 ? '' : 's'}. First error: ${result.firstError}`
          : '';
        this.status.lastRunStatus = 'success';
        await this.store.saveRun({
          id: runId,
          startedAt: this.status.lastRunStartedAt,
          completedAt: new Date().toISOString(),
          status: 'success',
          scannedCount: result.scanned,
          classifiedCount: result.classified,
          failedCount: result.failed,
          eventCount: result.eventsCreated
        });
        console.log(`[DetectionEngine] run success scanned=${result.scanned} classified=${result.classified} failed=${result.failed} eventsCreated=${result.eventsCreated}`);
      }
    } catch (error) {
      this.status.lastRunStatus = 'error';
      this.status.lastError = error instanceof Error ? error.message : 'Detection runner failed.';
      await this.store.saveRun({
        id: runId,
        startedAt: this.status.lastRunStartedAt,
        completedAt: new Date().toISOString(),
        status: 'error',
        error: this.status.lastError
      });
      console.error(`[DetectionEngine] run error ${this.status.lastError}`);
    } finally {
      if (locked && hasSupabaseLockConfig()) {
        await releaseSystemLock(LOCK_NAME).catch(() => undefined);
      }
      this.status.lastRunCompletedAt = new Date().toISOString();
      this.status.running = false;
      this.inFlight = false;
    }

    return this.getStatus();
  }

  private async acquireLock() {
    if (!hasSupabaseLockConfig()) return true;
    try {
      return await acquireSystemLock(LOCK_NAME, LOCK_TTL_SECONDS);
    } catch (error) {
      if (readBooleanEnv('DETECTION_REQUIRE_LOCK', false)) throw error;
      this.status.lastError = `Detection lock unavailable; running unlocked. ${error instanceof Error ? error.message : ''}`.trim();
      return true;
    }
  }

  private async runCycle() {
    const feed = await getOverviewFeed();
    const queueStates = await this.store.listTokenQueueState();
    const stateMap = new Map<string, QueueTokenState>();
    for (const token of queueStates) {
      stateMap.set(queueKey(token.chain, token.tokenAddress), token);
      stateMap.set(queueKey(token.chain, token.pairAddress), token);
    }
    const batch = selectDetectionBatch(feed.tokens, stateMap, this.status.batchSize, this.cursor);
    if (!batch.length) return { scanned: 0, classified: 0, failed: 0, eventsCreated: 0, firstError: '' };

    this.cursor = (this.cursor + batch.length) % Math.max(1, feed.tokens.length);
    const concurrency = readNumberEnv('DETECTION_DEX_CONCURRENCY', DEFAULT_CONCURRENCY);
    let classified = 0;
    let eventsCreated = 0;
    let failed = 0;
    let firstError = '';

    await mapWithConcurrency(batch, concurrency, async (candidate) => {
      const result = await this.processCandidate(candidate).catch((error) => {
        failed += 1;
        if (!firstError) firstError = error instanceof Error ? error.message : 'Candidate processing failed.';
        return { classified: false, eventCreated: false };
      });
      if (result.classified) classified += 1;
      if (result.eventCreated) eventsCreated += 1;
    });

    if (failed === batch.length && batch.length > 0) {
      throw new Error(firstError || 'All Detection candidates failed.');
    }

    return { scanned: batch.length, classified, failed, eventsCreated, firstError };
  }

  private async processCandidate(candidate: OverviewToken) {
    const record = await hydrateDetectionCandidate(candidate);
    if (!record) return { classified: false, eventCreated: false };

    const previousSnapshots = await this.store.getRecentSnapshots(record.snapshot.tokenId, 288);
    const previousClassification = await this.store.getLatestClassification(record.snapshot.tokenId);
    const features = calculateFeatures(record.snapshot, previousSnapshots);
    const classification = classifyToken({
      snapshot: record.snapshot,
      features,
      history: previousSnapshots,
      previousClassification
    });

    await this.store.upsertToken(record.token, record.snapshot);
    await this.store.saveSnapshot(record.snapshot);
    await this.store.saveFeatures(features);
    const classificationId = await this.store.saveClassification(classification);

    if (!shouldCreateDetectionEvent(classification, previousClassification)) {
      await this.store.upsertToken(record.token, record.snapshot, resolveScanSchedule(classification, previousClassification, false));
      return { classified: true, eventCreated: false };
    }

    const event = buildDetectionEvent(record, classification, classificationId);
    const eventCreated = await this.store.saveEvent(event, record.token.tokenId);
    if (eventCreated) {
      void this.smartAlerts.notifyDetectionEvent(event).catch(() => undefined);
    }
    await this.store.upsertToken(record.token, record.snapshot, resolveScanSchedule(classification, previousClassification, eventCreated));
    return { classified: true, eventCreated };
  }
}

export { severityScore };
