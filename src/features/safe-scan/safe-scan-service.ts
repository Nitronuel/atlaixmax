import { apiUrl } from '../../config';
import {
  type BubblemapsChain,
  type BubblemapsScanReport,
  type TokenNetworkDetection,
  BUBBLEMAPS_CHAINS,
  isLikelyBubblemapsAddress
} from '../../shared/bubblemaps';
import { BubblemapsScanReportSchema, TokenNetworkDetectionSchema } from '../../shared/bubblemaps-schema';

export type DetectedTokenNetwork = TokenNetworkDetection;

const inFlightReports = new Map<string, Promise<BubblemapsScanReport>>();
const evmChains = BUBBLEMAPS_CHAINS.filter((item) => item.family === 'EVM').map((item) => item.id);

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export const SafeScanService = {
  async scanToken(chain: BubblemapsChain, address: string) {
    const normalizedAddress = address.trim();
    if (!isLikelyBubblemapsAddress(normalizedAddress, chain)) {
      if (chain === 'solana') throw new Error('Solana scans require a valid Solana token address.');
      if (chain === 'tron') throw new Error('Tron scans require a valid Tron token address.');
      if (chain === 'ton') throw new Error('TON scans require a valid TON token address.');
      throw new Error('EVM scans require a valid 0x token address.');
    }

    const key = `${chain}:${normalizedAddress.toLowerCase()}`;
    const inFlight = inFlightReports.get(key);
    if (inFlight) return inFlight;
    const params = new URLSearchParams({ chain, address: normalizedAddress });
    const request = fetchJson<BubblemapsScanReport>(`/api/bubblemaps/report?${params.toString()}`).then((report) => {
      const parsed = BubblemapsScanReportSchema.parse(report) as BubblemapsScanReport;
      const endpoints = Object.values(parsed.endpoints);
      const configError = endpoints.find((endpoint) => endpoint.status === 'not_configured');
      if (configError) throw new Error(configError.error || 'Bubblemaps API key is not configured.');
      return parsed;
    }).finally(() => {
      inFlightReports.delete(key);
    });
    inFlightReports.set(key, request);
    return request;
  },

  async detectTokenNetwork(address: string): Promise<DetectedTokenNetwork | null> {
    const value = address.trim();
    if (!value) return null;
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      const params = new URLSearchParams({ address: value });
      const detection = await fetchJson<DetectedTokenNetwork | null>(`/api/bubblemaps/detect-network?${params.toString()}`);
      return detection ? TokenNetworkDetectionSchema.parse(detection) as DetectedTokenNetwork : {
        chain: evmChains.includes('eth') ? 'eth' : evmChains[0],
        address: value,
        confidence: 'low',
        source: 'Address format',
        matches: []
      };
    }
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
      const params = new URLSearchParams({ address: value });
      const detection = await fetchJson<DetectedTokenNetwork | null>(`/api/bubblemaps/detect-network?${params.toString()}`);
      return detection ? TokenNetworkDetectionSchema.parse(detection) as DetectedTokenNetwork : {
        chain: 'solana',
        address: value,
        confidence: 'medium',
        source: 'Address format',
        matches: []
      };
    }
    if (/^T[1-9A-HJ-NP-Za-km-z]{25,40}$/.test(value)) {
      const params = new URLSearchParams({ address: value });
      const detection = await fetchJson<DetectedTokenNetwork | null>(`/api/bubblemaps/detect-network?${params.toString()}`);
      return detection ? TokenNetworkDetectionSchema.parse(detection) as DetectedTokenNetwork : {
        chain: 'tron',
        address: value,
        confidence: 'medium',
        source: 'Address format',
        matches: []
      };
    }
    return null;
  }
};
