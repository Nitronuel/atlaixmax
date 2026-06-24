import type { DetectionEvent } from '../../src/shared/detection';
import { DetectionStore } from '../detection/store';
import type { SmartAlertTriggerRow } from '../smart-alerts/store';
import type { WatchlistAssetRow, WatchlistMonitorSettings } from './store';

export type WatchlistActivityItem = {
  id: string;
  assetId: string | null;
  assetSymbol: string;
  assetName: string;
  assetType: WatchlistAssetRow['asset_type'];
  title: string;
  detail: string;
  tone: 'bullish' | 'bearish' | 'neutral' | 'risk';
  source: 'detection' | 'smart-alert' | 'watchlist';
  createdAt: string;
  href: string | null;
};

export type WatchlistMetric = {
  label: string;
  value: number;
  note: string;
};

export type WatchlistSummary = {
  generatedAt: string;
  metrics: WatchlistMetric[];
  summary: string;
  activity: WatchlistActivityItem[];
};

const detectionStore = new DetectionStore();
const MAJOR_VOLUME_USD = 1_000_000;
const SUPPORTED_MONITOR_KEYS: Array<keyof WatchlistMonitorSettings> = [
  'detectionEvents',
  'riskChanges',
  'aiStateChanges',
  'majorVolumeEvents'
];
const RISK_TEXT_PATTERN = /risk|warning|high|critical|deterior|drain|exploit|rug|sell[-\s]?off|sell pressure|weak/i;
const AI_STATE_TEXT_PATTERN = /accumulat|distribution|recovery|stress|weak|breakout|continuation|reversal|drain|sell pressure|absorption|compression|expansion/i;
const VOLUME_TEXT_PATTERN = /volume|buy pressure|sell pressure|flow|large buy|large sell|expansion|compression/i;

function assetKey(asset: WatchlistAssetRow) {
  if (asset.asset_type === 'coin') return `coin:${asset.coin_id?.toLowerCase() || asset.symbol.toLowerCase()}`;
  return `token:${asset.chain_id?.toLowerCase() || ''}:${asset.token_address?.toLowerCase() || ''}`;
}

function eventKey(event: DetectionEvent) {
  return `token:${event.token.chain.toLowerCase()}:${event.token.address.toLowerCase()}`;
}

function triggerMatchesAsset(trigger: SmartAlertTriggerRow, asset: WatchlistAssetRow) {
  const metadata = trigger.metadata || {};
  const token = metadata.token as Record<string, unknown> | undefined;
  const triggerAddress = String(token?.address || token?.tokenAddress || metadata.tokenAddress || '').toLowerCase();
  const triggerChain = String(token?.chainId || token?.chain || metadata.chainId || '').toLowerCase();
  const title = `${trigger.title} ${trigger.message}`.toLowerCase();

  if (asset.asset_type === 'token') {
    const address = String(asset.token_address || '').toLowerCase();
    const chain = String(asset.chain_id || '').toLowerCase();
    if (address && triggerAddress === address && (!triggerChain || triggerChain === chain)) return true;
  }

  const symbol = asset.symbol.toLowerCase();
  const name = asset.name.toLowerCase();
  return Boolean(symbol && title.includes(symbol)) || Boolean(name && title.includes(name));
}

function toneForEvent(event: DetectionEvent): WatchlistActivityItem['tone'] {
  if (event.severity === 'critical' || event.severity === 'high') return 'risk';
  if (event.sentiment === 'bullish') return 'bullish';
  if (event.sentiment === 'bearish') return 'bearish';
  return 'neutral';
}

function toneForTrigger(trigger: SmartAlertTriggerRow): WatchlistActivityItem['tone'] {
  if (trigger.alert_type === 'Risk') return 'risk';
  const text = `${trigger.title} ${trigger.message} ${trigger.observed_value || ''}`.toLowerCase();
  if (/risk|warning|high|critical|deterior/i.test(text)) return 'risk';
  if (/bear|sell|weak|down|drain/i.test(text)) return 'bearish';
  if (/bull|buy|recover|inflow|accumulat|up/i.test(text)) return 'bullish';
  return 'neutral';
}

function eventText(event: DetectionEvent) {
  return `${event.eventType} ${event.summary} ${event.sentiment} ${event.severity}`;
}

function triggerText(trigger: SmartAlertTriggerRow) {
  return `${trigger.alert_type} ${trigger.title} ${trigger.message} ${trigger.observed_value || ''} ${trigger.threshold || ''}`;
}

function isRiskDetectionEvent(event: DetectionEvent) {
  return event.severity === 'critical' || event.severity === 'high' || RISK_TEXT_PATTERN.test(eventText(event));
}

function isRiskTrigger(trigger: SmartAlertTriggerRow) {
  return trigger.alert_type === 'Risk' || RISK_TEXT_PATTERN.test(triggerText(trigger));
}

function isAiStateDetectionEvent(event: DetectionEvent) {
  return AI_STATE_TEXT_PATTERN.test(eventText(event));
}

function isAiStateTrigger(trigger: SmartAlertTriggerRow) {
  return AI_STATE_TEXT_PATTERN.test(triggerText(trigger));
}

function isMajorVolumeDetectionEvent(event: DetectionEvent) {
  return Number(event.metrics?.volume24h || 0) >= MAJOR_VOLUME_USD || VOLUME_TEXT_PATTERN.test(eventText(event));
}

function isMajorVolumeTrigger(trigger: SmartAlertTriggerRow) {
  return trigger.alert_type === 'Volume' || VOLUME_TEXT_PATTERN.test(triggerText(trigger));
}

function detectionEventMatchesEnabledMonitor(asset: WatchlistAssetRow, event: DetectionEvent) {
  const monitors = asset.monitor_settings;
  return (
    Boolean(monitors.detectionEvents) ||
    (Boolean(monitors.riskChanges) && isRiskDetectionEvent(event)) ||
    (Boolean(monitors.aiStateChanges) && isAiStateDetectionEvent(event)) ||
    (Boolean(monitors.majorVolumeEvents) && isMajorVolumeDetectionEvent(event))
  );
}

function triggerMatchesEnabledMonitor(asset: WatchlistAssetRow, trigger: SmartAlertTriggerRow) {
  const monitors = asset.monitor_settings;
  return (
    (Boolean(monitors.detectionEvents) && trigger.alert_type === 'Detection') ||
    (Boolean(monitors.riskChanges) && isRiskTrigger(trigger)) ||
    (Boolean(monitors.aiStateChanges) && isAiStateTrigger(trigger)) ||
    (Boolean(monitors.majorVolumeEvents) && isMajorVolumeTrigger(trigger))
  );
}

function dateFromDetection(value: number) {
  return new Date(value).toISOString();
}

function activityFromDetection(event: DetectionEvent, asset: WatchlistAssetRow): WatchlistActivityItem {
  return {
    id: `detection:${event.id}`,
    assetId: asset.id,
    assetSymbol: asset.symbol || event.token.ticker,
    assetName: asset.name || event.token.name,
    assetType: asset.asset_type,
    title: event.eventType,
    detail: event.summary,
    tone: toneForEvent(event),
    source: 'detection',
    createdAt: dateFromDetection(event.detectedAt),
    href: `/detection/token/${encodeURIComponent(event.token.chain)}/${encodeURIComponent(event.token.address)}`
  };
}

function activityFromTrigger(trigger: SmartAlertTriggerRow, asset: WatchlistAssetRow): WatchlistActivityItem {
  return {
    id: `trigger:${trigger.id}`,
    assetId: asset.id,
    assetSymbol: asset.symbol,
    assetName: asset.name,
    assetType: asset.asset_type,
    title: trigger.title || 'Smart Alert',
    detail: trigger.message || 'Monitor condition was triggered.',
    tone: toneForTrigger(trigger),
    source: 'smart-alert',
    createdAt: trigger.created_at,
    href: null
  };
}

function summarizeStateCounts(assets: WatchlistAssetRow[], activity: WatchlistActivityItem[]) {
  const states = new Map<string, number>();
  assets.forEach((asset) => {
    const state = asset.state || '';
    if (state) states.set(state, (states.get(state) || 0) + 1);
  });
  activity.forEach((item) => {
    if (/accumulat/i.test(item.title)) states.set('Accumulation', (states.get('Accumulation') || 0) + 1);
    if (/recover/i.test(item.title)) states.set('Recovery', (states.get('Recovery') || 0) + 1);
    if (/risk|drain|sell|weak/i.test(item.title)) states.set('Risk Watch', (states.get('Risk Watch') || 0) + 1);
  });
  return states;
}

function createSummaryText(assets: WatchlistAssetRow[], activity: WatchlistActivityItem[]) {
  if (!assets.length) {
    return 'Add tokens or coins to start monitoring market events, risk changes, liquidity movement, and state shifts from one workspace.';
  }

  const last24h = activity.filter((item) => Date.now() - new Date(item.createdAt).getTime() <= 24 * 60 * 60 * 1000);
  const riskItems = last24h.filter((item) => item.tone === 'risk');
  const bullishItems = last24h.filter((item) => item.tone === 'bullish');
  const states = summarizeStateCounts(assets, last24h);
  const stateLine = [...states.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([state, count]) => `${count} ${state.toLowerCase()}`)
    .join(', ');

  if (!last24h.length) {
    return `${assets.length} assets are being monitored. No fresh Detection Engine or Smart Alert events matched this watchlist in the last 24 hours.`;
  }

  const first = `${assets.length} assets are being monitored with ${last24h.length} recent changes.`;
  const second = stateLine ? `Current watch states include ${stateLine}.` : '';
  const third = riskItems.length
    ? `${riskItems.length} risk-related changes need review.`
    : `${bullishItems.length} positive changes were detected and no matched risk events appeared in the last 24 hours.`;

  return [first, second, third].filter(Boolean).join(' ');
}

function countActiveMonitorAssets(assets: WatchlistAssetRow[]) {
  return assets.filter((asset) => SUPPORTED_MONITOR_KEYS.some((key) => asset.monitor_settings[key])).length;
}

function riskChangeCount(activity: WatchlistActivityItem[]) {
  return activity.filter((item) => (
    item.tone === 'risk' ||
    /risk|safescan|deterior|drain|critical|high/i.test(`${item.title} ${item.detail}`)
  )).length;
}

function changesInLast24h(activity: WatchlistActivityItem[]) {
  return activity.filter((item) => Date.now() - new Date(item.createdAt).getTime() <= 24 * 60 * 60 * 1000).length;
}

export async function buildWatchlistActivity(assets: WatchlistAssetRow[], triggers: SmartAlertTriggerRow[], limit = 30) {
  const assetByKey = new Map(assets.map((asset) => [assetKey(asset), asset]));
  const events = (await detectionStore.listEvents({ limit: 250 }).catch(() => ({ events: [] as DetectionEvent[] }))).events;
  const detectionItems = events
    .map((event) => {
      const asset = assetByKey.get(eventKey(event));
      return asset && detectionEventMatchesEnabledMonitor(asset, event) ? activityFromDetection(event, asset) : null;
    })
    .filter((item): item is WatchlistActivityItem => Boolean(item));

  const triggerItems = triggers.flatMap((trigger) => {
    const asset = assets.find((candidate) => triggerMatchesAsset(trigger, candidate));
    return asset && triggerMatchesEnabledMonitor(asset, trigger) ? [activityFromTrigger(trigger, asset)] : [];
  });

  return [...detectionItems, ...triggerItems]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function buildWatchlistSummary(assets: WatchlistAssetRow[], activity: WatchlistActivityItem[]): WatchlistSummary {
  const last24h = changesInLast24h(activity);
  const riskChanges = riskChangeCount(activity.filter((item) => Date.now() - new Date(item.createdAt).getTime() <= 24 * 60 * 60 * 1000));

  return {
    generatedAt: new Date().toISOString(),
    metrics: [
      { label: 'Assets Tracked', value: assets.length, note: `${assets.filter((asset) => asset.asset_type === 'token').length} tokens, ${assets.filter((asset) => asset.asset_type === 'coin').length} coins` },
      { label: 'New Events', value: last24h, note: 'Last 24h' },
      { label: 'Risk Changes', value: riskChanges, note: 'Matched alerts and events' },
      { label: 'Active Monitors', value: countActiveMonitorAssets(assets), note: 'Assets with monitors on' },
      { label: 'Last 24h Changes', value: last24h, note: 'Watchlist activity' }
    ],
    summary: createSummaryText(assets, activity),
    activity: activity.slice(0, 8)
  };
}

export function latestActivityByAsset(activity: WatchlistActivityItem[]) {
  const byAsset = new Map<string, WatchlistActivityItem>();
  activity.forEach((item) => {
    if (!item.assetId || byAsset.has(item.assetId)) return;
    byAsset.set(item.assetId, item);
  });
  return byAsset;
}
