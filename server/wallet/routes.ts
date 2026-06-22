import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendNotFound } from '../http/response';
import { WalletActivityService } from './activity-service';
import { WalletPortfolioService } from './service';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUPPORTED_PERIODS = new Set(['ALL', '1D', '1W', '1M', '>1M']);
const SUPPORTED_CHAINS = new Set(['All Chains', 'Ethereum', 'Solana', 'Base', 'BSC', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche']);
const SUPPORTED_ACTIVITY_KINDS = new Set(['all', 'buy', 'sell', 'swap', 'receive', 'send', 'approval', 'contract', 'unknown', 'large']);
const walletPortfolioService = new WalletPortfolioService();
const walletActivityService = new WalletActivityService();

function isValidWallet(address: string) {
  return EVM_ADDRESS_REGEX.test(address) || (!address.startsWith('0x') && SOLANA_ADDRESS_REGEX.test(address));
}

export class WalletRoutes {
  async handle(_request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    if (
      requestUrl.pathname !== '/api/wallet/portfolio'
      && requestUrl.pathname !== '/api/wallet/portfolio-fast'
      && requestUrl.pathname !== '/api/wallet/performance'
      && requestUrl.pathname !== '/api/wallet/activity'
    ) {
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

    if (requestUrl.pathname === '/api/wallet/activity') {
      const kind = requestUrl.searchParams.get('kind')?.trim() || 'all';
      const limit = Math.max(10, Math.min(Number(requestUrl.searchParams.get('limit')) || 500, 500));

      if (!SUPPORTED_ACTIVITY_KINDS.has(kind)) {
        sendJson(response, 400, { error: 'Unsupported wallet activity filter.' });
        return;
      }

      const activity = await walletActivityService.getActivity(address, chain as never, { period, kind, limit });
      sendJson(response, 200, activity);
      return;
    }

    const portfolio = await walletPortfolioService.getPortfolio(
      address,
      chain as never,
      period,
      requestUrl.pathname !== '/api/wallet/portfolio-fast'
    );
    sendJson(response, 200, portfolio);
  }
}
