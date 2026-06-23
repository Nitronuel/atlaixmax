import { readEnv } from '../env';
import { evaluateSmartAlertRule, type SmartAlertMarketSnapshot } from './evaluator';
import { SmartAlertStore, type SmartAlertRow } from './store';

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  info?: { imageUrl?: string };
};

export type SmartAlertTokenSnapshot = {
  address: string;
  pairAddress: string | null;
  chainId: string;
  name: string;
  symbol: string;
  priceUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  riskLevel: string | null;
  imageUrl?: string | null;
  source?: string;
};

type SmartAlertStatus = {
  enabled: boolean;
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastRunStatus: 'idle' | 'success' | 'error';
  lastError: string;
  intervalMs: number;
  batchSize: number;
  rulesChecked: number;
  triggersCreated: number;
};

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 100;

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

function parseNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeText(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function pickBestPair(pairs: DexPair[], address: string, chain = '') {
  const normalizedAddress = normalizeText(address);
  const normalizedChain = normalizeText(chain);
  const matching = pairs.filter((pair) => {
    const base = normalizeText(pair.baseToken?.address);
    const quote = normalizeText(pair.quoteToken?.address);
    const pairAddress = normalizeText(pair.pairAddress);
    const chainMatches = !normalizedChain || normalizeText(pair.chainId) === normalizedChain;
    return chainMatches && (base === normalizedAddress || quote === normalizedAddress || pairAddress === normalizedAddress);
  });
  const candidates = matching.length ? matching : pairs.filter((pair) => !normalizedChain || normalizeText(pair.chainId) === normalizedChain);
  return candidates.sort((left, right) => Number(right.liquidity?.usd || 0) - Number(left.liquidity?.usd || 0))[0] || null;
}

async function fetchPairsForAddress(address: string): Promise<DexPair[]> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.pairs) ? payload.pairs : [];
}

export async function lookupSmartAlertToken(address: string, chain = ''): Promise<SmartAlertTokenSnapshot | null> {
  const pairs = await fetchPairsForAddress(address);
  const pair = pickBestPair(pairs, address, chain);
  if (!pair?.baseToken?.address) return null;

  return {
    address: pair.baseToken.address,
    pairAddress: pair.pairAddress || null,
    chainId: pair.chainId || chain || 'unknown',
    name: pair.baseToken.name || pair.baseToken.symbol || 'Unknown token',
    symbol: pair.baseToken.symbol || pair.baseToken.name || 'TOKEN',
    priceUsd: parseNumber(pair.priceUsd),
    change24h: parseNumber(pair.priceChange?.h24),
    volume24h: parseNumber(pair.volume?.h24),
    liquidityUsd: parseNumber(pair.liquidity?.usd),
    riskLevel: null,
    imageUrl: pair.info?.imageUrl || null,
    source: 'dexscreener'
  };
}

function pairToSnapshot(pair: DexPair, fallbackAddress: string): SmartAlertMarketSnapshot {
  const buys = Number(pair.txns?.h24?.buys || 0);
  const sells = Number(pair.txns?.h24?.sells || 0);
  const side = sells > buys ? 'sell' : 'buy';

  return {
    tokenLabel: pair.baseToken?.symbol || pair.baseToken?.name || fallbackAddress,
    tokenAddress: pair.baseToken?.address || fallbackAddress,
    priceUsd: parseNumber(pair.priceUsd),
    volume24hUsd: parseNumber(pair.volume?.h24),
    liquidityUsd: parseNumber(pair.liquidity?.usd),
    whaleUsd: parseNumber(pair.volume?.h24),
    whaleSide: side,
    alphaEvent: null,
    riskSeverity: null
  };
}

async function getSnapshotForRule(rule: SmartAlertRow) {
  const tokenAddress = rule.token_address || (rule.metadata?.token as { address?: string } | undefined)?.address || '';
  if (!tokenAddress) return null;

  const pairs = await fetchPairsForAddress(tokenAddress);
  const pair = pickBestPair(pairs, tokenAddress, rule.chain_id);
  return pair ? pairToSnapshot(pair, tokenAddress) : null;
}

export class SmartAlertRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private status: SmartAlertStatus;

  constructor(private readonly store: SmartAlertStore) {
    this.status = {
      enabled: readBooleanEnv('SMART_ALERTS_ENABLED', true),
      running: false,
      lastRunStartedAt: null,
      lastRunCompletedAt: null,
      lastRunStatus: 'idle',
      lastError: '',
      intervalMs: readNumberEnv('SMART_ALERTS_INTERVAL_MS', DEFAULT_INTERVAL_MS),
      batchSize: readNumberEnv('SMART_ALERTS_BATCH_SIZE', DEFAULT_BATCH_SIZE),
      rulesChecked: 0,
      triggersCreated: 0
    };
  }

  start() {
    if (!this.status.enabled || this.timer) return;
    const initialDelay = readNumberEnv('SMART_ALERTS_INITIAL_DELAY_MS', 10_000);
    setTimeout(() => void this.runNow(), initialDelay);
    this.timer = setInterval(() => void this.runNow(), this.status.intervalMs);
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

    try {
      const rules = await this.store.listEnabledRules(this.status.batchSize);
      let triggersCreated = 0;

      for (const rule of rules) {
        const created = await this.evaluateRule(rule);
        triggersCreated += created;
      }

      this.status.rulesChecked = rules.length;
      this.status.triggersCreated = triggersCreated;
      this.status.lastRunStatus = 'success';
      return this.getStatus();
    } catch (error) {
      this.status.lastRunStatus = 'error';
      this.status.lastError = error instanceof Error ? error.message : 'Smart Alert runner failed.';
      return this.getStatus();
    } finally {
      this.status.lastRunCompletedAt = new Date().toISOString();
      this.status.running = false;
      this.inFlight = false;
    }
  }

  private async evaluateRule(rule: SmartAlertRow) {
    const now = new Date();
    const metadata = rule.metadata || {};
    const expiresAt = typeof metadata.expiresAt === 'string' ? new Date(metadata.expiresAt).getTime() : null;

    if (metadata.alertMode === 'detection_event') {
      return 0;
    }

    if (metadata.status === 'completed' || Number(rule.trigger_count || 0) > 0) {
      await this.store.updateRule(rule.id, {
        enabled: false,
        last_checked_at: now.toISOString(),
        metadata: { ...metadata, status: 'completed', completedAt: metadata.completedAt || rule.last_triggered_at || now.toISOString() }
      });
      return 0;
    }

    if (expiresAt && Number.isFinite(expiresAt) && now.getTime() >= expiresAt) {
      await this.store.updateRule(rule.id, {
        enabled: false,
        last_checked_at: now.toISOString(),
        metadata: { ...metadata, status: 'expired', expiredAt: metadata.expiredAt || now.toISOString() }
      });
      return 0;
    }

    const snapshot = await getSnapshotForRule(rule);
    if (!snapshot) {
      await this.store.updateRule(rule.id, {
        last_checked_at: now.toISOString(),
        last_error: 'No live market snapshot was available for this alert token.'
      });
      return 0;
    }

    if (metadata.alertMode === 'linked' && Array.isArray(metadata.conditions)) {
      return this.evaluateLinkedRule(rule, snapshot, now);
    }

    const result = evaluateSmartAlertRule(rule, snapshot, now);
    const patch: Partial<SmartAlertRow> = {
      last_checked_at: now.toISOString(),
      last_observed_value: result.observedValue,
      last_observed_at: now.toISOString(),
      last_error: result.lastError,
      ...(result.nextBaselineValue !== null ? {
        baseline_value: result.nextBaselineValue,
        baseline_observed_at: now.toISOString()
      } : {})
    };

    let created = 0;
    if (result.shouldTrigger) {
      const inserted = await this.store.insertTrigger({
        alert_rule_id: rule.id,
        alert_type: rule.alert_type,
        title: `${rule.alert_type} Alert`,
        message: result.message,
        observed_value: result.observedValue,
        threshold: rule.threshold,
        source: 'smart-alert-runner',
        dedupe_key: result.dedupeKey,
        metadata: {
          tokenLabel: snapshot.tokenLabel || null,
          tokenAddress: snapshot.tokenAddress || null,
          condition: rule.condition,
          thresholdKind: rule.threshold_kind,
          evaluatedAt: now.toISOString()
        }
      });
      created = inserted ? 1 : 0;
      patch.enabled = false;
      patch.last_triggered_at = now.toISOString();
      patch.trigger_count = Number(rule.trigger_count || 0) + created;
      patch.metadata = { ...metadata, status: 'completed', completedAt: now.toISOString() };
    }

    await this.store.updateRule(rule.id, patch);
    return created;
  }

  private async evaluateLinkedRule(rule: SmartAlertRow, snapshot: SmartAlertMarketSnapshot, now: Date) {
    const metadata = rule.metadata || {};
    const conditions = Array.isArray(metadata.conditions) ? metadata.conditions as any[] : [];
    const nextConditions = [];
    let created = 0;
    let lastObservedValue: string | null = null;
    let lastError: string | null = null;

    for (const condition of conditions) {
      if (condition.status === 'met') {
        nextConditions.push(condition);
        continue;
      }

      const result = evaluateSmartAlertRule({
        id: `${rule.id}:${condition.id}`,
        user_id: rule.user_id,
        alert_type: condition.alertType,
        target: rule.target,
        chain_id: rule.chain_id,
        condition: condition.condition,
        threshold_kind: condition.thresholdKind,
        threshold: condition.threshold,
        trigger_label: condition.label,
        cooldown_minutes: rule.cooldown_minutes,
        last_triggered_at: null,
        baseline_value: condition.baselineValue ?? null
      }, snapshot, now);

      lastObservedValue = result.observedValue;
      lastError = result.lastError;
      const nextCondition = {
        ...condition,
        observedValue: result.observedValue,
        lastError: result.lastError,
        ...(result.nextBaselineValue !== null ? { baselineValue: result.nextBaselineValue } : {})
      };

      if (result.shouldTrigger) {
        nextCondition.status = 'met';
        nextCondition.metAt = now.toISOString();
        const inserted = await this.store.insertTrigger({
          alert_rule_id: rule.id,
          alert_type: rule.alert_type,
          title: 'Partial target met',
          message: `${condition.label} met for ${snapshot.tokenLabel || rule.target}.`,
          observed_value: result.observedValue,
          threshold: condition.threshold,
          source: 'smart-alert-runner',
          dedupe_key: `${rule.id}:${condition.id}:partial`,
          metadata: {
            eventType: 'partial_met',
            conditionId: condition.id,
            evaluatedAt: now.toISOString()
          }
        });
        if (inserted) created += 1;
      }

      nextConditions.push(nextCondition);
    }

    const completedConditions = nextConditions.filter((condition) => condition.status === 'met').length;
    const allConditionsMet = completedConditions === nextConditions.length;
    if (allConditionsMet) {
      const inserted = await this.store.insertTrigger({
        alert_rule_id: rule.id,
        alert_type: rule.alert_type,
        title: 'Linked alert triggered',
        message: `All ${nextConditions.length} linked conditions were met for ${snapshot.tokenLabel || rule.target}.`,
        observed_value: lastObservedValue,
        threshold: `${nextConditions.length} conditions`,
        source: 'smart-alert-runner',
        dedupe_key: `${rule.id}:linked-complete`,
        metadata: {
          eventType: 'linked_triggered',
          completedConditions,
          totalConditions: nextConditions.length,
          evaluatedAt: now.toISOString()
        }
      });
      if (inserted) created += 1;
    }

    await this.store.updateRule(rule.id, {
      last_checked_at: now.toISOString(),
      last_observed_value: lastObservedValue,
      last_observed_at: now.toISOString(),
      last_error: lastError,
      enabled: allConditionsMet ? false : rule.enabled,
      trigger_count: Number(rule.trigger_count || 0) + created,
      last_triggered_at: allConditionsMet ? now.toISOString() : rule.last_triggered_at,
      metadata: {
        ...metadata,
        status: allConditionsMet ? 'completed' : 'active',
        conditions: nextConditions,
        ...(allConditionsMet ? { completedAt: now.toISOString() } : {})
      }
    });

    return created;
  }
}
