import {
  type InsightXNetwork,
  INSIGHTX_SUPPORTED_NETWORKS,
  isLikelyInsightXAddress,
  normalizeInsightXNetwork
} from '../../src/shared/insightx';

export function parseInsightXRequest(searchParams: URLSearchParams) {
  const network = normalizeInsightXNetwork(searchParams.get('network'));
  const address = String(searchParams.get('address') || searchParams.get('token') || '').trim();
  if (!network) {
    throw new Error('Select a supported InsightX network.');
  }
  validateInsightXRequest(network, address);
  return { network, address };
}

export function validateInsightXRequest(network: InsightXNetwork, address: string) {
  if (!INSIGHTX_SUPPORTED_NETWORKS.has(network)) {
    throw new Error('Select a supported InsightX network.');
  }
  if (!address) {
    throw new Error('Enter a token address.');
  }
  if (!isLikelyInsightXAddress(address, network)) {
    if (network === 'sol') throw new Error('Solana scans require a valid Solana address.');
    if (network === 'sui') throw new Error('Sui scans require a valid Sui token address.');
    throw new Error('EVM scans require a valid 0x token address.');
  }
}
