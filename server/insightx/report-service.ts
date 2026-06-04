import {
  type InsightXNetwork,
  type LabelResponse,
  type SafeScanReport
} from '../../src/shared/insightx';
import {
  AtlasSnapshotSchema,
  BundlersResponseSchema,
  DexMetricsSchema,
  InsidersResponseSchema,
  LabelResponseSchema,
  ScannerResponseSchema,
  SnipersResponseSchema
} from '../../src/shared/insightx-schema';
import { InsightXClient, INSIGHTX_LABEL_CACHE_TTL_MS } from './client';
import { validateInsightXRequest } from './validation';

type ReportEndpointKey = keyof SafeScanReport['endpoints'];

function collectWalletAddress(value: unknown, addresses: Set<string>) {
  const candidate = String(value || '').trim();
  if (candidate && addresses.size < 100) addresses.add(candidate);
}

function collectLabelAddresses(report: Partial<SafeScanReport['endpoints']>, fallbackAddress: string) {
  const addresses = new Set<string>();
  const sources = [
    report.scanner?.data,
    report.snipers?.data,
    report.bundlers?.data,
    report.insiders?.data,
    report.clusters?.data
  ];

  for (const source of sources) {
    const data = source as Record<string, unknown> | null | undefined;
    const advanced = (data?.results as { advanced?: Record<string, unknown> } | undefined)?.advanced || {};
    collectWalletAddress((advanced.creator as { address?: string } | undefined)?.address, addresses);

    for (const key of ['top_holders', 'multichain_top_holders', 'snipers', 'bundlers', 'insiders']) {
      const rows = key in advanced ? advanced[key] : data?.[key];
      if (Array.isArray(rows)) {
        for (const row of rows.slice(0, 30)) {
          collectWalletAddress(typeof row === 'string' ? row : row?.address || row?.wallet || row?.owner, addresses);
        }
      }
    }

    const clusters = Array.isArray(data?.clusters) ? data.clusters : Array.isArray(data) ? data : [];
    for (const cluster of clusters.slice(0, 12)) {
      const members = Array.isArray(cluster?.members)
        ? cluster.members
        : Array.isArray(cluster?.wallets)
          ? cluster.wallets
          : Array.isArray(cluster?.cluster_addresses)
            ? cluster.cluster_addresses
            : [];
      for (const member of members.slice(0, 8)) {
        collectWalletAddress(typeof member === 'string' ? member : member?.address || member?.wallet || member?.owner, addresses);
      }
    }
  }

  if (!addresses.size) addresses.add(fallbackAddress);
  return [...addresses];
}

function endpointPath(key: Exclude<ReportEndpointKey, 'labels'>, network: string, address: string) {
  switch (key) {
    case 'scanner':
      return `/scanner/v1/tokens/${network}/${address}`;
    case 'overview':
      return `/dex-metrics/v1/${network}/${address}`;
    case 'clusters':
      return `/dex-metrics/v1/${network}/${address}/clusters`;
    case 'snipers':
      return `/dex-metrics/v1/${network}/${address}/snipers`;
    case 'bundlers':
      return `/dex-metrics/v1/${network}/${address}/bundlers`;
    case 'insiders':
      return `/dex-metrics/v1/${network}/${address}/insiders`;
    case 'atlasLatest':
      return `/atlas/v1/${network}/${address}/snapshots/latest`;
    case 'atlasTimestamps':
      return `/atlas/v1/${network}/${address}/snapshots`;
  }
}

export class InsightXReportService {
  constructor(private readonly client: InsightXClient) {}

  async buildReport(network: InsightXNetwork, address: string): Promise<SafeScanReport> {
    validateInsightXRequest(network, address);
    const encodedNetwork = encodeURIComponent(network);
    const encodedAddress = encodeURIComponent(address);
    const cacheBase = `${network}:${address.toLowerCase()}`;

    const endpointKeys: Array<Exclude<ReportEndpointKey, 'labels'>> = [
      'scanner',
      'overview',
      'clusters',
      'snipers',
      'bundlers',
      'insiders',
      'atlasLatest',
      'atlasTimestamps'
    ];

    const entries = await Promise.all(endpointKeys.map(async (key) => {
      const result = await this.client.fetchEndpoint({
        path: endpointPath(key, encodedNetwork, encodedAddress),
        cacheKey: `${key}:${cacheBase}`,
        endpointKey: key,
        network,
        schema: schemaForEndpoint(key)
      });
      return [key, result] as const;
    }));

    const endpoints = Object.fromEntries(entries) as SafeScanReport['endpoints'];
    const labelAddresses = collectLabelAddresses(endpoints, address);
    endpoints.labels = await this.client.fetchEndpoint<LabelResponse[]>({
      path: `/labels/v1/${encodedNetwork}/${encodeURIComponent(labelAddresses.join(','))}`,
      cacheKey: `labels:${network}:${labelAddresses.sort().join(',').toLowerCase()}`,
      endpointKey: 'labels',
      network,
      schema: LabelResponseSchema.array(),
      ttlMs: INSIGHTX_LABEL_CACHE_TTL_MS
    });

    return {
      network,
      address,
      generatedAt: new Date().toISOString(),
      source: 'insightx',
      endpoints: {
        scanner: endpoints.scanner as SafeScanReport['endpoints']['scanner'],
        overview: endpoints.overview as SafeScanReport['endpoints']['overview'],
        clusters: endpoints.clusters,
        snipers: endpoints.snipers as SafeScanReport['endpoints']['snipers'],
        bundlers: endpoints.bundlers as SafeScanReport['endpoints']['bundlers'],
        insiders: endpoints.insiders as SafeScanReport['endpoints']['insiders'],
        atlasLatest: endpoints.atlasLatest as SafeScanReport['endpoints']['atlasLatest'],
        atlasTimestamps: endpoints.atlasTimestamps,
        labels: endpoints.labels
      }
    };
  }

}

function schemaForEndpoint(key: Exclude<ReportEndpointKey, 'labels'>) {
  switch (key) {
    case 'scanner':
      return ScannerResponseSchema;
    case 'overview':
      return DexMetricsSchema;
    case 'clusters':
      return undefined;
    case 'snipers':
      return SnipersResponseSchema;
    case 'bundlers':
      return BundlersResponseSchema;
    case 'insiders':
      return InsidersResponseSchema;
    case 'atlasLatest':
      return AtlasSnapshotSchema;
    case 'atlasTimestamps':
      return undefined;
  }
}
