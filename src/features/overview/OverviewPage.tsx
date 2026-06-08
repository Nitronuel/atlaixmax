import { useEffect, useState } from 'react';
import type { OverviewToken } from '../../shared/overview';
import { LiveAlphaFeed } from './LiveAlphaFeed';
import { MarketPulse } from './MarketPulse';
import { OverviewFiltersModal } from './OverviewFilters';
import { OverviewService } from './overview-service';
import { DEFAULT_OVERVIEW_FILTERS, type OverviewFilters } from './overview-utils';
import { TokenSearch } from './TokenSearch';

const FEED_REFRESH_INTERVAL_MS = 60_000;
const FEED_CACHE_KEY = 'atlaix:overview-feed';

type CachedOverviewFeed = {
  generatedAt: string;
  tokens: OverviewToken[];
};

function readCachedFeed(): CachedOverviewFeed | null {
  try {
    const cached = window.localStorage.getItem(FEED_CACHE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as CachedOverviewFeed;
    return Array.isArray(parsed.tokens) && parsed.generatedAt ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedFeed(feed: CachedOverviewFeed) {
  try {
    window.localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(feed));
  } catch {
    // Local storage is best-effort; the network feed remains the source of truth.
  }
}

function applyFeed(response: CachedOverviewFeed, setTokens: (tokens: OverviewToken[]) => void, setLastUpdated: (date: Date) => void) {
  setTokens(response.tokens);
  setLastUpdated(new Date(response.generatedAt));
  writeCachedFeed({ generatedAt: response.generatedAt, tokens: response.tokens });
}

export function OverviewPage() {
  const [tokens, setTokens] = useState<OverviewToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<OverviewFilters>(DEFAULT_OVERVIEW_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  async function loadFeed(showLoading = true, force = false) {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await OverviewService.getFeed(force);
      applyFeed(response, setTokens, setLastUpdated);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Live Alpha Feed is unavailable.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function refreshFeed() {
    setSyncing(true);
    try {
      await loadFeed(false, true);
    } catch (nextError) {
      setError(nextError instanceof Error ? `Refresh failed: ${nextError.message}` : 'Live Alpha Feed refresh failed.');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const cached = readCachedFeed();
    if (cached) {
      setTokens(cached.tokens);
      setLastUpdated(new Date(cached.generatedAt));
      setLoading(false);
      void loadFeed(false);
    } else {
      void loadFeed();
    }

    const interval = window.setInterval(() => {
      if (!document.hidden) void loadFeed(false);
    }, FEED_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="overview-page">
      <MarketPulse tokens={tokens} />
      <TokenSearch tokens={tokens} query={searchQuery} onQueryChange={setSearchQuery} />
      <LiveAlphaFeed
        tokens={tokens}
        loading={loading || syncing}
        error={error}
        lastUpdated={lastUpdated}
        searchQuery={searchQuery}
        filters={filters}
        onFiltersClick={() => setFiltersOpen(true)}
        onRefresh={() => void refreshFeed()}
      />
      <OverviewFiltersModal
        open={filtersOpen}
        filters={filters}
        tokens={tokens}
        onClose={() => setFiltersOpen(false)}
        onApply={(nextFilters) => {
          setFilters(nextFilters);
          setFiltersOpen(false);
        }}
      />
    </div>
  );
}
