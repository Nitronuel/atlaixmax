import { useEffect, useMemo, useState } from 'react';
import type { WalletChain, WalletPortfolio, WalletStats, WalletTimeFilter } from './wallet-types';
import { buildWalletStats } from './wallet-utils';
import { WalletPortfolioService } from './wallet-service';

const emptyPortfolio: WalletPortfolio = {
  netWorth: '$0.00',
  assets: [],
  providerStatus: 'ready',
  generatedAt: new Date(0).toISOString()
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && /aborted/i.test(error.message);
}

export function useWalletPortfolio(address: string | undefined, chain: WalletChain, timeFilter: WalletTimeFilter) {
  const [portfolio, setPortfolio] = useState<WalletPortfolio>(emptyPortfolio);
  const [loading, setLoading] = useState(Boolean(address));
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!address) {
      setPortfolio(emptyPortfolio);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    WalletPortfolioService.getPortfolio(address, chain, timeFilter, controller.signal, refreshKey > 0)
      .then(setPortfolio)
      .catch((nextError: unknown) => {
        if (controller.signal.aborted || isAbortError(nextError)) return;
        setPortfolio({ ...emptyPortfolio, providerStatus: 'error', message: 'Wallet portfolio is unavailable.' });
        setError(nextError instanceof Error ? nextError.message : 'Wallet portfolio is unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [address, chain, timeFilter, refreshKey]);

  const stats: WalletStats = useMemo(() => buildWalletStats(portfolio.assets, portfolio.netWorth), [portfolio]);

  return {
    portfolio,
    stats,
    loading,
    error,
    refreshPortfolio: () => setRefreshKey((current) => current + 1)
  };
}
