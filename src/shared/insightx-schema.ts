import { z } from 'zod';

export const InsightXNetworkSchema = z.enum(['sol', 'eth', 'base', 'bsc', 'monad', 'xlayer', 'abs', 'sui']);

export const EndpointResultSchema = <T extends z.ZodType>(dataSchema: T) => z.object({
  status: z.enum(['available', 'unsupported', 'missing', 'error', 'rate_limited', 'not_configured']),
  data: dataSchema.nullable(),
  error: z.string().optional(),
  httpStatus: z.number().optional(),
  cached: z.boolean().optional(),
  cachedAt: z.string().optional(),
  fetchedAt: z.string(),
  retryAfter: z.string().nullable().optional()
}).passthrough();

export const InsightXTokenSchema = z.object({
  address: z.string(),
  name: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  logo: z.string().nullable().optional(),
  decimals: z.number().nullable().optional(),
  total_supply: z.number().nullable().optional(),
  age: z.number().nullable().optional()
}).passthrough();

export const ScannerResponseSchema = z.object({
  network: z.object({
    name: z.string().optional(),
    symbol: z.string().optional()
  }).passthrough().optional(),
  token: InsightXTokenSchema.optional(),
  results: z.object({
    generated_at: z.number().optional(),
    simple: z.object({
      score: z.number().optional(),
      message: z.string().optional(),
      reasons: z.array(z.string()).optional()
    }).passthrough().optional(),
    advanced: z.record(z.string(), z.unknown()).optional()
  }).passthrough().optional()
}).passthrough();

export const DexMetricsSchema = z.object({
  cluster_pct: z.number().optional(),
  snipers_pct: z.number().optional(),
  bundlers_pct: z.number().optional(),
  dev_pct: z.number().optional(),
  insiders_pct: z.number().optional(),
  top10_pct: z.number().optional()
}).passthrough();

export const WalletEntrySchema = z.object({
  address: z.string().optional(),
  wallet: z.string().optional(),
  owner: z.string().optional(),
  balance: z.number().optional(),
  amount: z.number().optional(),
  token_balance: z.number().optional(),
  percentage: z.number().optional(),
  pct: z.number().optional(),
  supply_pct: z.number().optional(),
  total_pct: z.number().optional(),
  label: z.string().optional(),
  tags: z.array(z.string()).optional(),
  smart_contract: z.boolean().optional(),
  reasons: z.array(z.string()).nullable().optional()
}).passthrough();

export const SnipersResponseSchema = z.object({
  total_sniper_pct: z.number().optional(),
  count: z.object({
    total: z.number().optional(),
    sold_partially: z.number().optional(),
    sold_fully: z.number().optional(),
    bought_more: z.number().optional()
  }).passthrough().optional(),
  snipers: z.array(WalletEntrySchema).optional()
}).passthrough();

export const BundlersResponseSchema = z.object({
  total_bundlers_pct: z.number().optional(),
  bundlers: z.array(WalletEntrySchema).optional()
}).passthrough();

export const InsidersResponseSchema = z.object({
  total_insiders_pct: z.number().optional(),
  insiders: z.array(WalletEntrySchema).optional()
}).passthrough();

export const LabelResponseSchema = z.object({
  address: z.string(),
  label: z.string(),
  tags: z.array(z.string()).optional(),
  smart_contract: z.boolean()
}).passthrough();

export const AtlasSnapshotSchema = z.object({
  nodes: z.array(z.record(z.string(), z.unknown())).optional(),
  holders: z.array(z.record(z.string(), z.unknown())).optional(),
  links: z.array(z.record(z.string(), z.unknown())).optional(),
  edges: z.array(z.record(z.string(), z.unknown())).optional(),
  relationships: z.array(z.record(z.string(), z.unknown())).optional(),
  token: z.record(z.string(), z.unknown()).optional()
}).passthrough();

export const SafeScanReportSchema = z.object({
  network: InsightXNetworkSchema,
  address: z.string(),
  generatedAt: z.string(),
  source: z.literal('insightx'),
  endpoints: z.object({
    scanner: EndpointResultSchema(ScannerResponseSchema),
    overview: EndpointResultSchema(DexMetricsSchema),
    clusters: EndpointResultSchema(z.unknown()),
    snipers: EndpointResultSchema(SnipersResponseSchema),
    bundlers: EndpointResultSchema(BundlersResponseSchema),
    insiders: EndpointResultSchema(InsidersResponseSchema),
    atlasLatest: EndpointResultSchema(AtlasSnapshotSchema),
    atlasTimestamps: EndpointResultSchema(z.unknown()),
    labels: EndpointResultSchema(z.array(LabelResponseSchema))
  }).passthrough()
}).passthrough();
