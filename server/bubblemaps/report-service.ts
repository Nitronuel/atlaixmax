import type {
  BubblemapsChain,
  BubblemapsScanReport,
  ChainDetails,
  TokenNetworkDetection,
  TokenDetails,
  TokenHolder,
  TokenMap,
  TokenMetrics
} from '../../src/shared/bubblemaps';
import {
  BUBBLEMAPS_CHAINS,
  isLikelyBubblemapsAddress
} from '../../src/shared/bubblemaps';
import {
  ChainDetailsSchema,
  TokenDetailsSchema,
  TokenHolderSchema,
  TokenMapSchema,
  TokenMetricsSchema
} from '../../src/shared/bubblemaps-schema';
import { BubblemapsClient, BUBBLEMAPS_CHAIN_CACHE_TTL_MS, BUBBLEMAPS_DEFAULT_CACHE_TTL_MS } from './client';
import { TtlCache } from '../shared/cache';
import { validateBubblemapsRequest } from './validation';

export class BubblemapsReportService {
  private readonly reportCache = new TtlCache();
  private readonly reportInflight = new Map<string, Promise<BubblemapsScanReport>>();
  private readonly detectionCache = new TtlCache();
  private readonly detectionInflight = new Map<string, Promise<TokenNetworkDetection | null>>();

  constructor(private readonly client: BubblemapsClient) {}

  async buildReport(chain: BubblemapsChain, address: string): Promise<BubblemapsScanReport> {
    validateBubblemapsRequest(chain, address);
    const reportCacheKey = `report:${chain}:${address.toLowerCase()}`;
    const cached = this.reportCache.get(reportCacheKey);
    if (cached) return cached.value as BubblemapsScanReport;

    const inflight = this.reportInflight.get(reportCacheKey);
    if (inflight) return inflight;

    const request = this.fetchReport(chain, address, reportCacheKey)
      .finally(() => {
        this.reportInflight.delete(reportCacheKey);
      });
    this.reportInflight.set(reportCacheKey, request);
    return request;
  }

  async detectNetwork(address: string): Promise<TokenNetworkDetection | null> {
    const normalizedAddress = address.trim();
    if (!normalizedAddress) return null;

    const candidateChains = BUBBLEMAPS_CHAINS
      .map((item) => item.id)
      .filter((chain) => isLikelyBubblemapsAddress(normalizedAddress, chain));

    if (!candidateChains.length) return null;

    const cacheKey = `detect:${normalizedAddress.toLowerCase()}`;
    const cached = this.detectionCache.get(cacheKey);
    if (cached) return cached.value as TokenNetworkDetection | null;

    const inflight = this.detectionInflight.get(cacheKey);
    if (inflight) return inflight;

    const request = this.fetchNetworkDetection(candidateChains, normalizedAddress, cacheKey)
      .finally(() => {
        this.detectionInflight.delete(cacheKey);
      });
    this.detectionInflight.set(cacheKey, request);
    return request;
  }

  private async fetchNetworkDetection(candidateChains: BubblemapsChain[], address: string, cacheKey: string) {
    const encodedAddress = encodeURIComponent(address);
    const responses = await Promise.all(candidateChains.map(async (chain) => {
      const token = await this.client.fetchEndpoint<TokenDetails>({
        path: `/v0/tokens/metadata/${encodeURIComponent(chain)}/${encodedAddress}`,
        cacheKey: `token:${chain}:${address.toLowerCase()}`,
        endpointKey: 'token-detect',
        params: { return_token_stats: true },
        schema: TokenDetailsSchema
      });
      return { chain, token };
    }));

    const matches = responses
      .filter(({ token }) => {
        if (token.status !== 'available' || !token.data) return false;
        const metadata = token.data.metadata;
        const hasNamedToken = [metadata.name, metadata.symbol].some((value) => value && value !== '???');
        return metadata.is_indexed || hasNamedToken;
      })
      .map(({ chain, token }) => ({
        chain,
        name: token.data?.metadata.name,
        symbol: token.data?.metadata.symbol,
        isIndexed: token.data?.metadata.is_indexed,
        transfersCount: token.data?.stats?.transfers_count ?? null
      }))
      .sort((left, right) => {
        if (left.isIndexed !== right.isIndexed) return left.isIndexed ? -1 : 1;
        return (right.transfersCount || 0) - (left.transfersCount || 0);
      });

    if (!matches.length) {
      const fallback = candidateChains.length === 1
        ? {
            chain: candidateChains[0],
            address,
            confidence: 'medium' as const,
            source: 'Address format',
            matches: []
          }
        : null;
      this.detectionCache.set(cacheKey, fallback, BUBBLEMAPS_DEFAULT_CACHE_TTL_MS, new Date().toISOString());
      return fallback;
    }

    const detection: TokenNetworkDetection = {
      chain: matches[0].chain,
      address,
      confidence: matches.length === 1 ? 'high' : 'medium',
      source: 'Bubblemaps token metadata',
      matches
    };
    this.detectionCache.set(cacheKey, detection, BUBBLEMAPS_DEFAULT_CACHE_TTL_MS, new Date().toISOString());
    return detection;
  }

  private async fetchReport(chain: BubblemapsChain, address: string, reportCacheKey: string): Promise<BubblemapsScanReport> {
    const encodedChain = encodeURIComponent(chain);
    const encodedAddress = encodeURIComponent(address);
    const cacheBase = `${chain}:${address.toLowerCase()}`;

    const [chains, token, metrics, holders, map] = await Promise.all([
      this.client.fetchEndpoint<ChainDetails[]>({
        path: '/v0/chains',
        cacheKey: 'chains:v0',
        endpointKey: 'chains',
        schema: ChainDetailsSchema.array(),
        ttlMs: BUBBLEMAPS_CHAIN_CACHE_TTL_MS
      }),
      this.client.fetchEndpoint<TokenDetails>({
        path: `/v0/tokens/metadata/${encodedChain}/${encodedAddress}`,
        cacheKey: `token:${cacheBase}`,
        endpointKey: 'token',
        params: { return_token_stats: true },
        schema: TokenDetailsSchema
      }),
      this.client.fetchEndpoint<TokenMetrics>({
        path: `/v0/tokens/metrics/${encodedChain}/${encodedAddress}`,
        cacheKey: `metrics:${cacheBase}`,
        endpointKey: 'metrics',
        schema: TokenMetricsSchema
      }),
      this.client.fetchEndpoint<TokenHolder[]>({
        path: `/v0/tokens/holders/${encodedChain}/${encodedAddress}`,
        cacheKey: `holders:${cacheBase}:250`,
        endpointKey: 'holders',
        params: { limit: 250, return_metadata: true },
        schema: TokenHolderSchema.array()
      }),
      this.client.fetchEndpoint<TokenMap>({
        path: `/v0/tokens/map/${encodedChain}/${encodedAddress}`,
        cacheKey: `map:${cacheBase}:250`,
        endpointKey: 'map',
        params: {
          limit: 250,
          return_nodes: true,
          return_relationships: true,
          return_clusters: true,
          use_magic_nodes: true,
          use_time_nodes: true
        },
        schema: TokenMapSchema
      })
    ]);

    const report: BubblemapsScanReport = {
      chain,
      address,
      generatedAt: new Date().toISOString(),
      source: 'bubblemaps',
      endpoints: { chains, token, metrics, holders, map }
    };

    this.reportCache.set(reportCacheKey, report, BUBBLEMAPS_DEFAULT_CACHE_TTL_MS, report.generatedAt);
    return report;
  }
}
