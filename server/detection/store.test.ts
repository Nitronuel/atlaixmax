import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DetectionEvent } from '../../src/shared/detection';
import { DetectionStore } from './store';

describe('detection event storage', () => {
  const originalCwd = process.cwd();
  const originalSupabaseUrl = process.env.SUPABASE_URL;
  const originalSupabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSupabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'atlaix-detection-store-'));
    process.chdir(workspace);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv('SUPABASE_URL', originalSupabaseUrl);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', originalSupabaseServiceRoleKey);
    restoreEnv('SUPABASE_SERVICE_KEY', originalSupabaseServiceKey);
    rmSync(workspace, { recursive: true, force: true });
  });

  it('appends repeated lifecycle events while reporting only the first lifecycle as new', async () => {
    const store = new DetectionStore();
    const first = makeEvent({ id: '11111111-1111-4111-8111-111111111111', classificationId: '21111111-1111-4111-8111-111111111111', score: 72 });
    const second = makeEvent({ id: '11111111-1111-4111-8111-222222222222', classificationId: '21111111-1111-4111-8111-222222222222', score: 83 });

    await expect(store.saveEvent(first, 'solana:pair')).resolves.toBe(true);
    await expect(store.saveEvent(second, 'solana:pair')).resolves.toBe(false);

    const response = await store.listEvents({ limit: 10 });
    expect(response.events).toHaveLength(2);
    expect(response.events.map((event) => event.id)).toEqual([second.id, first.id]);
    expect(response.events[0].eventVersion).toBe(2);
    expect(response.events[0].previousScore).toBe(72);
    expect(response.events[0].scoreDelta).toBe(11);
    expect(response.events[0].lifecycleId).toBe('solana:pair:ACCUMULATION');
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function makeEvent(overrides: Partial<DetectionEvent>): DetectionEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    eventType: 'Accumulation',
    summary: 'Consistent wallet accumulation observed.',
    sentiment: 'bullish',
    severity: 'medium',
    score: 72,
    detectedAt: Date.now(),
    token: {
      name: 'FarmTown',
      ticker: 'FARM',
      address: 'FarmTokenAddress',
      chain: 'solana',
      pairAddress: 'pair'
    },
    metrics: {
      volume24h: 250_000,
      liquidity: 80_000,
      marketCap: 1_000_000,
      priceChange24h: 12,
      netFlow: 20_000
    },
    classificationId: '21111111-1111-4111-8111-111111111111',
    dedupeKey: 'solana:pair:ACCUMULATION',
    lifecycleId: 'solana:pair:ACCUMULATION',
    lifecycleStatus: 'new',
    eventVersion: 1,
    lastUpdatedAt: Date.now(),
    previousScore: null,
    scoreDelta: null,
    riskDelta: null,
    ...overrides
  };
}
