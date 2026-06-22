import { useEffect, useMemo, useState } from 'react';
import type { WalletActivity, WalletActivityFilter, WalletActivitySummary, WalletChain, WalletTimeFilter, WalletTradedToken } from './wallet-types';
import { WalletPortfolioService } from './wallet-service';

const emptySummary: WalletActivitySummary = {
  lastActiveAt: 0,
  recentBuys: 0,
  recentSells: 0,
  largestMoveUsd: 0,
  largestMoveLabel: 'No activity',
  mostTradedToken: 'No token yet',
  netFlowUsd: 0
};

const emptyActivity: WalletActivity = {
  activities: [],
  summary: emptySummary,
  tradedTokens: [] as WalletTradedToken[],
  providerStatus: 'ready',
  generatedAt: new Date(0).toISOString()
};

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && /aborted/i.test(error.message);
}

export function useWalletActivity(address: string | undefined, chain: WalletChain, timeFilter: WalletTimeFilter, kind: WalletActivityFilter, enabled = true) {
  const [activity, setActivity] = useState<WalletActivity>(emptyActivity);
  const [loading, setLoading] = useState(Boolean(address));
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!address || !enabled) {
      setActivity(emptyActivity);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    WalletPortfolioService.getActivity(address, chain, timeFilter, kind, controller.signal, refreshKey > 0)
      .then(setActivity)
      .catch((nextError: unknown) => {
        if (controller.signal.aborted || isAbortError(nextError)) return;
        setActivity({ ...emptyActivity, providerStatus: 'error', message: 'Wallet activity is unavailable.' });
        setError(nextError instanceof Error ? nextError.message : 'Wallet activity is unavailable.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [address, chain, timeFilter, kind, refreshKey, enabled]);

  return useMemo(() => ({
    activity,
    loading,
    error,
    refreshActivity: () => setRefreshKey((current) => current + 1)
  }), [activity, error, loading]);
}
