import { DetectionResearchStore, type OutcomeRow, type ResearchSetupRow } from './store';

type LabelSummary = {
  eventLabel: string;
  sampleSize: number;
  completed: number;
  wins: number;
  losses: number;
  neutrals: number;
  unresolved: number;
  winRateBps: number | null;
  averageReturn6hBps: number | null;
  averageReturn24hBps: number | null;
  averageDrawdownBps: number | null;
};

export type BaselineReport = {
  generatedAt: string;
  sampleSize: number;
  labels: LabelSummary[];
};

export async function buildBaselineReport(store = new DetectionResearchStore()): Promise<BaselineReport> {
  const [setups, outcomes] = await Promise.all([
    store.listRecentSetups(5_000),
    store.listOutcomeRows(10_000)
  ]);
  return buildBaselineReportFromRows(setups, outcomes);
}

export function buildBaselineReportFromRows(setups: ResearchSetupRow[], outcomes: OutcomeRow[]): BaselineReport {
  const outcomesByEvent = new Map(outcomes.map((outcome) => [outcome.event_id, outcome]));
  const groups = new Map<string, Array<{ setup: ResearchSetupRow; outcome: OutcomeRow | null }>>();

  for (const setup of setups) {
    const key = setup.event_label || 'UNKNOWN';
    groups.set(key, [...(groups.get(key) || []), { setup, outcome: outcomesByEvent.get(setup.event_id) || null }]);
  }

  const labels = [...groups.entries()]
    .map(([eventLabel, rows]) => summarizeLabel(eventLabel, rows.map((row) => row.outcome)))
    .sort((left, right) => right.sampleSize - left.sampleSize);

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: setups.length,
    labels
  };
}

function summarizeLabel(eventLabel: string, outcomes: Array<OutcomeRow | null>): LabelSummary {
  const completed = outcomes.filter((outcome) => outcome?.outcome_status === 'complete');
  const wins = outcomes.filter((outcome) => outcome?.result === 'win').length;
  const losses = outcomes.filter((outcome) => outcome?.result === 'loss').length;
  const neutrals = outcomes.filter((outcome) => outcome?.result === 'neutral').length;
  const unresolved = outcomes.filter((outcome) => !outcome || outcome.result === 'unresolved' || outcome.outcome_status === 'unresolved').length;

  return {
    eventLabel,
    sampleSize: outcomes.length,
    completed: completed.length,
    wins,
    losses,
    neutrals,
    unresolved,
    winRateBps: completed.length ? Math.round((wins / completed.length) * 10_000) : null,
    averageReturn6hBps: average(outcomes.map((outcome) => outcome?.return_6h_bps ?? null)),
    averageReturn24hBps: average(outcomes.map((outcome) => outcome?.return_24h_bps ?? null)),
    averageDrawdownBps: average(outcomes.map((outcome) => outcome?.max_drawdown_24h_bps ?? null))
  };
}

function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => Number.isFinite(value));
  if (!usable.length) return null;
  return Math.round(usable.reduce((sum, value) => sum + value, 0) / usable.length);
}
