import type { DetectionSeverity, DetectionSentiment } from '../../src/shared/detection';

export const ASSISTANT_TOOL_NAMES = [
  'get_token_overview',
  'get_token_deep_brief',
  'get_token_profile',
  'get_wallet_deep_brief',
  'get_platform_updates',
  'get_detection_events',
  'get_detection_summary',
  'get_detection_token_recent_events',
  'get_detection_token_history',
  'get_detection_event_detail',
  'explain_detection_event_type',
  'compare_detection_events',
  'run_safe_scan',
  'get_safe_scan_brief',
  'get_safe_scan_holders',
  'get_safe_scan_clusters',
  'explain_safe_scan_metric',
  'prepare_alert_setup',
  'get_smart_alert_status',
  'open_token_details'
] as const;

export type AssistantToolName = typeof ASSISTANT_TOOL_NAMES[number];
export type AssistantToolSafety = 'read' | 'draft' | 'confirmable' | 'write';

type AssistantToolSchema = {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

export type AssistantToolDefinition = {
  name: AssistantToolName;
  safety: AssistantToolSafety;
  description: string;
  parameters: AssistantToolSchema;
};

export type AssistantToolArgs = {
  address?: string;
  chain?: string;
  query?: string;
  eventType?: string;
  metricName?: string;
  severity?: DetectionSeverity | 'all';
  sentiment?: DetectionSentiment | 'all';
  responseStyle?: 'brief' | 'detailed';
};

const stringParam = (description: string) => ({ type: 'string', description });
const optionalScopeProperties = {
  address: stringParam('Token contract, mint, or wallet address when the user provides one.'),
  chain: stringParam('Blockchain/network name such as ethereum, base, bsc, solana, or arbitrum.'),
  query: stringParam('Ticker, token name, event id, or short search phrase from the user.'),
  responseStyle: {
    type: 'string',
    enum: ['brief', 'detailed'],
    description: 'Use detailed only when the user asks for deep analysis, full details, or everything available.'
  }
};

const detectionProperties = {
  ...optionalScopeProperties,
  eventType: stringParam('Detection event type, such as Liquidity Drain, Accumulation, Distribution, Pump, or Dump.'),
  severity: {
    type: 'string',
    enum: ['critical', 'high', 'medium', 'low', 'all'],
    description: 'Severity filter when the user asks for a specific severity.'
  },
  sentiment: {
    type: 'string',
    enum: ['bullish', 'bearish', 'neutral', 'all'],
    description: 'Sentiment filter when the user asks for bullish, bearish, or neutral detections.'
  }
};

const safeScanProperties = {
  ...optionalScopeProperties,
  metricName: stringParam('Safe Scan metric name such as Bubblemaps score, Gini, HHI, Nakamoto, largest holder, largest cluster, or supply exposure.')
};

const schema = (properties: Record<string, unknown>, required: string[] = []): AssistantToolSchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {})
});

export const ASSISTANT_TOOLS: AssistantToolDefinition[] = [
  {
    name: 'get_token_profile',
    safety: 'read',
    description: 'Use when the user asks generally about a token, coin, ticker, current performance, profile, or what is happening with it. Good default for broad token questions.',
    parameters: schema(optionalScopeProperties)
  },
  {
    name: 'get_token_overview',
    safety: 'read',
    description: 'Use when the user asks for token price, market cap, liquidity, volume, or a short market overview.',
    parameters: schema(optionalScopeProperties)
  },
  {
    name: 'get_token_deep_brief',
    safety: 'read',
    description: 'Use when the user asks for a deeper token brief, full analysis, or all available market details.',
    parameters: schema(optionalScopeProperties)
  },
  {
    name: 'get_detection_events',
    safety: 'read',
    description: 'Use when the user asks to show, list, find, filter, browse, or get the latest Detection Engine events or flagged tokens. This is the correct tool for "latest event in the detection engine".',
    parameters: schema(detectionProperties)
  },
  {
    name: 'get_detection_summary',
    safety: 'read',
    description: 'Use when the user asks what Detection Engine is seeing overall, recent signals, market risk, latest activity, or a broad detection summary. Use get_detection_events instead when the user asks for the latest event.',
    parameters: schema(detectionProperties)
  },
  {
    name: 'get_detection_token_recent_events',
    safety: 'read',
    description: 'Use when the user or UI needs the most recent 5 Detection Engine events for one specific token, especially for AI assessment that compares the latest event with prior events.',
    parameters: schema({
      address: stringParam('Required token contract or mint address.'),
      chain: stringParam('Token chain such as ethereum, base, bsc, solana, or arbitrum.'),
      query: stringParam('Optional ticker or token name if address is not known.')
    })
  },
  {
    name: 'get_detection_token_history',
    safety: 'read',
    description: 'Use when the user asks whether a token has been flagged before, wants prior detections, history, timeline, or repeated signals for one token.',
    parameters: schema(detectionProperties)
  },
  {
    name: 'get_detection_event_detail',
    safety: 'read',
    description: 'Use when the user asks why a token was flagged, wants score/severity/evidence, asks about a specific detection, or says "why this was detected".',
    parameters: schema(detectionProperties)
  },
  {
    name: 'explain_detection_event_type',
    safety: 'read',
    description: 'Use when the user asks what a Detection Engine event type means, such as liquidity drain, accumulation, distribution, breakout, pump, or dump.',
    parameters: schema({ eventType: detectionProperties.eventType }, ['eventType'])
  },
  {
    name: 'compare_detection_events',
    safety: 'read',
    description: 'Use when the user asks to compare detections, compare bullish versus bearish signals, or rank recent detection events.',
    parameters: schema(detectionProperties)
  },
  {
    name: 'run_safe_scan',
    safety: 'read',
    description: 'Backward-compatible Safe Scan entry point. Use get_safe_scan_brief for most Safe Scan, token safety, holder concentration, and Bubblemaps risk questions.',
    parameters: schema(optionalScopeProperties)
  },
  {
    name: 'get_safe_scan_brief',
    safety: 'read',
    description: 'Use when the user asks for Safe Scan results, token safety, rug/scam risk, Bubblemaps score, holder concentration, supply exposure, decentralization, or whether a token looks safe.',
    parameters: schema(safeScanProperties)
  },
  {
    name: 'get_safe_scan_holders',
    safety: 'read',
    description: 'Use when the user asks who holds the token, top holders, largest holder, holder concentration, whale wallets, CEX/DEX/contract holder exposure, or holder table details.',
    parameters: schema(safeScanProperties)
  },
  {
    name: 'get_safe_scan_clusters',
    safety: 'read',
    description: 'Use when the user asks about Bubblemaps clusters, linked wallets, largest cluster, connected holders, wallet relationship graph, or whether holders are connected.',
    parameters: schema(safeScanProperties)
  },
  {
    name: 'explain_safe_scan_metric',
    safety: 'read',
    description: 'Use when the user asks what a Safe Scan or Bubblemaps metric means, such as score, Gini, HHI, Nakamoto, supply exposure, bundles, largest holder, or largest cluster.',
    parameters: schema(safeScanProperties)
  },
  {
    name: 'get_wallet_deep_brief',
    safety: 'read',
    description: 'Use when the user asks about a wallet, holdings, portfolio, PnL, tracked wallet, smart money address, or wallet behavior.',
    parameters: schema(optionalScopeProperties)
  },
  {
    name: 'get_platform_updates',
    safety: 'read',
    description: 'Use when the user asks for current market updates, trending tokens, what to watch, or broad platform/market activity.',
    parameters: schema({ responseStyle: optionalScopeProperties.responseStyle })
  },
  {
    name: 'get_smart_alert_status',
    safety: 'read',
    description: 'Use only when the user asks about Intelligence Monitor, alert runner status, alert health, saved alert rules, or whether alerts are working. Do not use for Detection Engine events, flagged tokens, or market events.',
    parameters: schema({})
  },
  {
    name: 'prepare_alert_setup',
    safety: 'draft',
    description: 'Use when the user wants to create, prepare, monitor, watch, or be notified about a token or condition. This only drafts setup; the user must confirm before saving.',
    parameters: schema(optionalScopeProperties)
  },
  {
    name: 'open_token_details',
    safety: 'read',
    description: 'Use when the user asks to open or navigate to a token details page.',
    parameters: schema(optionalScopeProperties)
  }
];

export const OPENROUTER_TOOLS = ASSISTANT_TOOLS.map((tool) => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
}));

export function isAssistantToolName(value: string): value is AssistantToolName {
  return (ASSISTANT_TOOL_NAMES as readonly string[]).includes(value);
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

export function validateAssistantToolArgs(value: unknown): AssistantToolArgs {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const args: AssistantToolArgs = {};
  const address = cleanString(raw.address, 140);
  const chain = cleanString(raw.chain, 40);
  const query = cleanString(raw.query, 160);
  const eventType = cleanString(raw.eventType, 80);
  const metricName = cleanString(raw.metricName, 80);
  const severity = enumValue(raw.severity, ['critical', 'high', 'medium', 'low', 'all'] as const);
  const sentiment = enumValue(raw.sentiment, ['bullish', 'bearish', 'neutral', 'all'] as const);
  const responseStyle = enumValue(raw.responseStyle, ['brief', 'detailed'] as const);

  if (address) args.address = address;
  if (chain) args.chain = chain;
  if (query) args.query = query;
  if (eventType) args.eventType = eventType;
  if (metricName) args.metricName = metricName;
  if (severity) args.severity = severity;
  if (sentiment) args.sentiment = sentiment;
  if (responseStyle) args.responseStyle = responseStyle;

  return args;
}
