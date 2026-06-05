import { useEffect, useState } from 'react';
import type { OverviewToken } from '../../shared/overview';
import { LiveAlphaFeed } from './LiveAlphaFeed';
import { MarketPulse } from './MarketPulse';
import { OverviewFiltersModal } from './OverviewFilters';
import { OverviewService } from './overview-service';
import { DEFAULT_OVERVIEW_FILTERS, type OverviewFilters } from './overview-utils';
import { TokenSearch } from './TokenSearch';

export function OverviewPage() {
  const [tokens, setTokens] = useState<OverviewToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<OverviewFilters>(DEFAULT_OVERVIEW_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  async function loadFeed(force = false) {
    setLoading(true);
    setError(null);
    try {
      const response = await OverviewService.getFeed(force);
      setTokens(response.tokens);
      setLastUpdated(new Date(response.generatedAt));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Live Alpha Feed is unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadFeed();
    const interval = window.setInterval(() => {
      if (!document.hidden) void loadFeed();
    }, 45_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="overview-page">
      <MarketPulse tokens={tokens} />
      <TokenSearch tokens={tokens} query={searchQuery} onQueryChange={setSearchQuery} />
      <LiveAlphaFeed
        tokens={tokens}
        loading={loading}
        error={error}
        lastUpdated={lastUpdated}
        searchQuery={searchQuery}
        filters={filters}
        onFiltersClick={() => setFiltersOpen(true)}
        onRefresh={() => void loadFeed(true)}
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
