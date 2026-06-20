import { z } from 'zod';

const nullableString = z.string().nullable().optional();

export const ChainDetailsSchema = z.object({
  id: z.string(),
  name: z.string(),
  dexscreener_id: nullableString,
  coingecko_id: nullableString
}).passthrough();

export const TokenMetadataSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  is_indexed: z.boolean(),
  img_url: nullableString
}).passthrough();

export const TokenDetailsSchema = z.object({
  token_key: z.object({
    chain: z.string(),
    address: z.string()
  }).passthrough(),
  metadata: TokenMetadataSchema,
  stats: z.object({
    transfers_count: z.number(),
    min_date: nullableString,
    max_date: nullableString
  }).passthrough().nullable().optional()
}).passthrough();

export const AddressDetailsSchema = z.object({
  label: nullableString,
  degree: z.number(),
  is_supernode: z.boolean(),
  is_contract: z.boolean(),
  is_cex: z.boolean(),
  is_dex: z.boolean(),
  entity_id: nullableString,
  inward_relations: z.number(),
  outward_relations: z.number(),
  first_activity_date: nullableString
}).passthrough();

export const TokenHolderSchema = z.object({
  address: z.string(),
  address_details: AddressDetailsSchema.nullable().optional(),
  holder_data: z.object({
    amount: z.number(),
    rank: z.number(),
    share: z.number()
  }).passthrough(),
  is_shown_on_map: z.boolean().optional()
}).passthrough();

export const TokenMetricsSchema = z.object({
  supply_stats: z.object({
    cexs: z.number(),
    dexs: z.number(),
    contracts: z.number(),
    fresh_wallets: z.number(),
    top_10_adjusted: z.number(),
    bundles: z.number()
  }).passthrough(),
  scores: z.object({
    bubblemaps_score: z.number(),
    gini_index: z.number(),
    herfindahl_hirschman_index: z.number(),
    nakamoto_coefficient: z.number()
  }).passthrough()
}).passthrough();

export const GroupedTransferSchema = z.object({
  from_address: z.string(),
  to_address: z.string(),
  rel_type: z.literal('GROUPED_TRANSFER').default('GROUPED_TRANSFER'),
  data: z.object({
    total_value: z.number(),
    total_transfers: z.number(),
    first_date: z.number(),
    last_date: z.number(),
    token_key: z.object({
      chain: z.string(),
      address: z.string()
    }).passthrough()
  }).passthrough()
}).passthrough();

export const TokenMapSchema = z.object({
  metadata: z.object({
    dt_update: nullableString,
    ts_update: z.number().nullable().optional()
  }).passthrough(),
  metrics: TokenMetricsSchema,
  nodes: z.object({
    top_holders: TokenHolderSchema.array(),
    magic_nodes: z.array(z.object({
      address: z.string(),
      address_details: AddressDetailsSchema.nullable().optional(),
      is_shown_on_map: z.boolean().optional()
    }).passthrough()).nullable().optional(),
    time_nodes: z.array(z.object({
      address: z.string(),
      relationships: GroupedTransferSchema.array()
    }).passthrough()).nullable().optional()
  }).passthrough().nullable().optional(),
  relationships: GroupedTransferSchema.array().nullable().optional(),
  clusters: z.array(z.object({
    share: z.number(),
    amount: z.number(),
    holder_count: z.number(),
    holders: z.string().array()
  }).passthrough()).nullable().optional()
}).passthrough();

export const EndpointResultSchema = <T extends z.ZodType>(schema: T) => z.object({
  status: z.enum(['available', 'unsupported', 'missing', 'error', 'rate_limited', 'not_configured']),
  data: schema.nullable(),
  error: z.string().optional(),
  httpStatus: z.number().optional(),
  cached: z.boolean().optional(),
  cachedAt: z.string().optional(),
  fetchedAt: z.string(),
  retryAfter: z.string().nullable().optional()
});

export const BubblemapsScanReportSchema = z.object({
  chain: z.string(),
  address: z.string(),
  generatedAt: z.string(),
  source: z.literal('bubblemaps'),
  endpoints: z.object({
    token: EndpointResultSchema(TokenDetailsSchema),
    metrics: EndpointResultSchema(TokenMetricsSchema),
    holders: EndpointResultSchema(TokenHolderSchema.array()),
    map: EndpointResultSchema(TokenMapSchema),
    chains: EndpointResultSchema(ChainDetailsSchema.array())
  })
}).passthrough();

export const TokenNetworkDetectionSchema = z.object({
  chain: z.string(),
  address: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  source: z.string(),
  matches: z.array(z.object({
    chain: z.string(),
    name: nullableString,
    symbol: nullableString,
    isIndexed: z.boolean().optional(),
    transfersCount: z.number().nullable().optional()
  }))
}).passthrough();
