import { describe, expect, it } from 'vitest';
import { BubblemapsReportService } from './report-service';

describe('BubblemapsReportService', () => {
  it('fans out to chains, metadata, metrics, holders, and map endpoints', async () => {
    const calls: string[] = [];
    const client = {
      fetchEndpoint: async (options: { endpointKey: string; path: string }) => {
        calls.push(`${options.endpointKey}:${options.path}`);
        if (options.endpointKey === 'chains') return { status: 'available', data: [], fetchedAt: 'now' };
        if (options.endpointKey === 'token') {
          return {
            status: 'available',
            data: {
              token_key: { chain: 'eth', address: '0x1111111111111111111111111111111111111111' },
              metadata: { name: 'Token', symbol: 'TOK', is_indexed: true },
              stats: { transfers_count: 10 }
            },
            fetchedAt: 'now'
          };
        }
        if (options.endpointKey === 'metrics') {
          return {
            status: 'available',
            data: {
              supply_stats: { cexs: 0, dexs: 0, contracts: 0, fresh_wallets: 0, top_10_adjusted: 0.1, bundles: 0 },
              scores: { bubblemaps_score: 75, gini_index: 0.4, herfindahl_hirschman_index: 0.1, nakamoto_coefficient: 8 }
            },
            fetchedAt: 'now'
          };
        }
        if (options.endpointKey === 'holders') return { status: 'available', data: [], fetchedAt: 'now' };
        return {
          status: 'available',
          data: {
            metadata: {},
            metrics: {
              supply_stats: { cexs: 0, dexs: 0, contracts: 0, fresh_wallets: 0, top_10_adjusted: 0.1, bundles: 0 },
              scores: { bubblemaps_score: 75, gini_index: 0.4, herfindahl_hirschman_index: 0.1, nakamoto_coefficient: 8 }
            },
            nodes: { top_holders: [] },
            relationships: [],
            clusters: []
          },
          fetchedAt: 'now'
        };
      }
    };
    const service = new BubblemapsReportService(client as never);

    const report = await service.buildReport('eth', '0x1111111111111111111111111111111111111111');

    expect(report.source).toBe('bubblemaps');
    expect(report.endpoints.metrics.status).toBe('available');
    expect(calls.some((call) => call.startsWith('chains:/v0/chains'))).toBe(true);
    expect(calls.some((call) => call.startsWith('token:/v0/tokens/metadata/eth/'))).toBe(true);
    expect(calls.some((call) => call.startsWith('map:/v0/tokens/map/eth/'))).toBe(true);
  });
});
