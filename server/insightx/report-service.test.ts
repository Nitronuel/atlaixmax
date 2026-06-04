import { describe, expect, it } from 'vitest';
import { InsightXReportService } from './report-service';

describe('InsightXReportService', () => {
  it('fans out to scanner, metrics, atlas, and labels endpoints', async () => {
    const calls: string[] = [];
    const client = {
      fetchEndpoint: async (options: { endpointKey: string; path: string }) => {
        calls.push(`${options.endpointKey}:${options.path}`);
        if (options.endpointKey === 'scanner') {
          return {
            status: 'available',
            data: {
              results: {
                advanced: {
                  creator: { address: '0x2222222222222222222222222222222222222222' }
                }
              }
            },
            fetchedAt: 'now'
          };
        }
        return { status: 'available', data: options.endpointKey === 'labels' ? [] : {}, fetchedAt: 'now' };
      }
    };
    const service = new InsightXReportService(client as never);

    const report = await service.buildReport('eth', '0x1111111111111111111111111111111111111111');

    expect(report.source).toBe('insightx');
    expect(report.endpoints.scanner.status).toBe('available');
    expect(calls.some((call) => call.startsWith('scanner:/scanner/v1/tokens/eth/'))).toBe(true);
    expect(calls.some((call) => call.startsWith('atlasLatest:/atlas/v1/eth/'))).toBe(true);
    expect(calls.some((call) => call.startsWith('labels:/labels/v1/eth/'))).toBe(true);
  });
});
