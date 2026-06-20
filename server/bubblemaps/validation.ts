import {
  type BubblemapsChain,
  isLikelyBubblemapsAddress,
  normalizeBubblemapsChain
} from '../../src/shared/bubblemaps';

export function validateBubblemapsRequest(chain: BubblemapsChain, address: string) {
  if (!normalizeBubblemapsChain(chain)) {
    throw new Error('Unsupported Bubblemaps chain.');
  }
  if (!isLikelyBubblemapsAddress(address, chain)) {
    if (chain === 'solana') throw new Error('Solana scans require a valid Solana token address.');
    if (chain === 'tron') throw new Error('Tron scans require a valid Tron token address.');
    if (chain === 'ton') throw new Error('TON scans require a valid TON token address.');
    throw new Error('EVM scans require a valid 0x token address.');
  }
}

export function parseBubblemapsRequest(params: URLSearchParams) {
  const chain = normalizeBubblemapsChain(params.get('chain') || params.get('network'));
  const address = params.get('address')?.trim() || '';
  if (!chain) throw new Error('Choose a supported Bubblemaps chain.');
  validateBubblemapsRequest(chain, address);
  return { chain, address };
}
