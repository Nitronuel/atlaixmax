import type { WalletActivityFilter, WalletChain } from '../../src/features/wallet-tracker/wallet-types';
import { WalletPortfolioService } from './service';

type ActivityOptions = {
  period: string;
  kind: WalletActivityFilter | string;
  limit: number;
};

const walletService = new WalletPortfolioService();

export class WalletActivityService {
  async getActivity(address: string, chain: WalletChain, options: ActivityOptions) {
    return walletService.getActivity(address, chain, options);
  }
}
