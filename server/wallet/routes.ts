import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendNotFound } from '../http/response';
import { WalletPortfolioService } from './service';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUPPORTED_PERIODS = new Set(['ALL', '1D', '1W', '1M', '>1M']);
const SUPPORTED_CHAINS = new Set(['All Chains', 'Ethereum', 'Solana', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche']);
const walletPortfolioService = new WalletPortfolioService();

function isValidWallet(address: string) {
  return EVM_ADDRESS_REGEX.test(address) || (!address.startsWith('0x') && SOLANA_ADDRESS_REGEX.test(address));
}

export class WalletRoutes {
  async handle(_request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    if (requestUrl.pathname !== '/api/wallet/portfolio') {
      sendNotFound(response);
      return;
    }

    const address = requestUrl.searchParams.get('address')?.trim() || '';
    const chain = requestUrl.searchParams.get('chain')?.trim() || '';
    const period = requestUrl.searchParams.get('period')?.trim() || 'ALL';

    if (!isValidWallet(address)) {
      sendJson(response, 400, { error: 'Enter a valid EVM or Solana wallet address.' });
      return;
    }

    if (!SUPPORTED_CHAINS.has(chain)) {
      sendJson(response, 400, { error: 'Unsupported wallet chain.' });
      return;
    }

    if (!SUPPORTED_PERIODS.has(period)) {
      sendJson(response, 400, { error: 'Unsupported wallet period.' });
      return;
    }

    const portfolio = await walletPortfolioService.getPortfolio(address, chain as never, period);
    sendJson(response, 200, portfolio);
  }
}
