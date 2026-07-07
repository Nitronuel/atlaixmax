import { useEffect, useMemo, useState } from 'react';
import type { CoinGeckoCoin } from '../../shared/coingecko';
import type { DetectionEvent } from '../../shared/detection';
import type { OverviewToken } from '../../shared/overview';
import { DetectionService } from '../detection/detection-service';
import { CoinAlphaFeed } from './CoinAlphaFeed';
import { CoinFeedService } from './coin-feed-service';
import { CoinSearch } from './CoinSearch';
import { FeedModeSwitch, type FeedMode } from './FeedModeSwitch';
import { LiveAlphaFeed } from './LiveAlphaFeed';
import { MarketPulse } from './MarketPulse';
import { buildLatestDetectionEventLookup, detectionEventLabelForToken } from './overview-detection-events';
import { OverviewFiltersModal } from './OverviewFilters';
import { OverviewService } from './overview-service';
import { DEFAULT_OVERVIEW_FILTERS, type OverviewFilters } from './overview-utils';
import { TokenSearch } from './TokenSearch';

const FEED_REFRESH_INTERVAL_MS = 60_000;
const FEED_CACHE_MAX_AGE_MS = FEED_REFRESH_INTERVAL_MS * 2;
const FEED_CACHE_KEY = 'atlaix:overview-feed';
const COIN_FEED_CACHE_KEY = 'atlaix:coingecko-feed';

type CachedOverviewFeed = {
  generatedAt: string;
  tokens: OverviewToken[];
};

type CachedCoinFeed = {
  generatedAt: string;
  coins: CoinGeckoCoin[];
};

function readCachedFeed<T extends { generatedAt: string }>(key: string, field: 'tokens' | 'coins'): T | null {
  try {
    const cached = window.localStorage.getItem(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as T & Record<string, unknown>;
    const generatedAt = Date.parse(String(parsed.generatedAt || ''));
    if (!Number.isFinite(generatedAt) || Date.now() - generatedAt > FEED_CACHE_MAX_AGE_MS) return null;
    return Array.isArray(parsed[field]) && parsed.generatedAt ? parsed as T : null;
  } catch {
    return null;
  }
}

function writeCachedFeed(key: string, feed: CachedOverviewFeed | CachedCoinFeed) {
  try {
    window.localStorage.setItem(key, JSON.stringify(feed));
  } catch {
    // Local storage is best-effort; the network feed is still the source of truth.
  }
}

function applyFeed(response: CachedOverviewFeed, setTokens: (tokens: OverviewToken[]) => void) {
  setTokens(response.tokens);
  writeCachedFeed(FEED_CACHE_KEY, { generatedAt: response.generatedAt, tokens: response.tokens });
}

function applyCoinFeed(response: CachedCoinFeed, setCoins: (coins: CoinGeckoCoin[]) => void, setLastUpdated: (date: Date) => void) {
  setCoins(response.coins);
  setLastUpdated(new Date(response.generatedAt));
  writeCachedFeed(COIN_FEED_CACHE_KEY, { generatedAt: response.generatedAt, coins: response.coins });
}

export function OverviewPage() {
  const [feedMode, setFeedMode] = useState<FeedMode>('tokens');
  const [tokens, setTokens] = useState<OverviewToken[]>([]);
  const [coins, setCoins] = useState<CoinGeckoCoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [coinsLoading, setCoinsLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coinsError, setCoinsError] = useState<string | null>(null);
  const [coinsLastUpdated, setCoinsLastUpdated] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<OverviewFilters>(DEFAULT_OVERVIEW_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detectionEvents, setDetectionEvents] = useState<DetectionEvent[]>([]);
  const detectionEventLookup = useMemo(() => buildLatestDetectionEventLookup(detectionEvents), [detectionEvents]);
  const detectionEventOptions = useMemo(() => (
    Array.from(new Set(tokens.map((token) => detectionEventLabelForToken(detectionEventLookup, token))))
      .sort((left, right) => (left === 'None' ? 1 : right === 'None' ? -1 : left.localeCompare(right)))
  ), [detectionEventLookup, tokens]);
  const coinEventOptions = useMemo(() => Array.from(new Set(coins.map((coin) => coin.event))).sort(), [coins]);

  async function loadDetectionEvents() {
    try {
      const response = await DetectionService.getEvents();
      setDetectionEvents(response.events);
    } catch {
      setDetectionEvents([]);
    }
  }

  async function loadFeed(showLoading = true, force = false) {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await OverviewService.getFeed(force);
      applyFeed(response, setTokens);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Live Market Feed is unavailable.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  async function loadCoinFeed(showLoading = true, force = false) {
    if (showLoading) setCoinsLoading(true);
    setCoinsError(null);
    try {
      let response = await CoinFeedService.getFeed(force);
      if (!force && !response.coins.length) {
        response = await CoinFeedService.getFeed(true);
      }
      applyCoinFeed(response, setCoins, setCoinsLastUpdated);
    } catch (nextError) {
      setCoinsError(nextError instanceof Error ? nextError.message : 'Coin feed is unavailable.');
    } finally {
      if (showLoading) setCoinsLoading(false);
    }
  }

  async function refreshFeed() {
    setSyncing(true);
    try {
      if (feedMode === 'coins') await loadCoinFeed(false, true);
      else await Promise.all([loadFeed(false, true), loadDetectionEvents()]);
    } catch (nextError) {
      setError(nextError instanceof Error ? `Refresh failed: ${nextError.message}` : 'Live Market Feed refresh failed.');
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const cached = readCachedFeed<CachedOverviewFeed>(FEED_CACHE_KEY, 'tokens');
    if (cached) {
      setTokens(cached.tokens);
      setLoading(false);
      void loadFeed(false);
      void loadDetectionEvents();
    } else {
      void loadFeed();
      void loadDetectionEvents();
    }

    const cachedCoins = readCachedFeed<CachedCoinFeed>(COIN_FEED_CACHE_KEY, 'coins');
    if (cachedCoins) {
      setCoins(cachedCoins.coins);
      setCoinsLastUpdated(new Date(cachedCoins.generatedAt));
      setCoinsLoading(false);
      void loadCoinFeed(false);
    } else {
      void loadCoinFeed();
    }

    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void loadFeed(false);
        void loadCoinFeed(false);
        void loadDetectionEvents();
      }
    }, FEED_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setSearchQuery('');
    setFilters(DEFAULT_OVERVIEW_FILTERS);
  }, [feedMode]);

  useEffect(() => {
    if (feedMode === 'coins' && !coinsLoading && (!coins.length || coinsError)) {
      void loadCoinFeed(true, true);
    }
    if (feedMode === 'tokens' && !loading && (!tokens.length || error)) {
      void Promise.all([loadFeed(true), loadDetectionEvents()]);
    }
  }, [feedMode]);

  return (
    <div className="overview-page">
      <MarketPulse tokens={tokens} />
      <div className="overview-feed-controls">
        <FeedModeSwitch value={feedMode} onChange={setFeedMode} />
        {feedMode === 'coins' ? (
          <CoinSearch coins={coins} query={searchQuery} onQueryChange={setSearchQuery} />
        ) : (
          <TokenSearch tokens={tokens} query={searchQuery} onQueryChange={setSearchQuery} />
        )}
      </div>
      {feedMode === 'coins' ? (
        <CoinAlphaFeed
          coins={coins}
          loading={coinsLoading || syncing}
          error={coinsError}
          lastUpdated={coinsLastUpdated}
          searchQuery={searchQuery}
          filters={filters}
          onFiltersClick={() => setFiltersOpen(true)}
          onRefresh={() => void refreshFeed()}
        />
      ) : (
        <LiveAlphaFeed
          tokens={tokens}
          loading={loading || syncing}
          error={error}
          searchQuery={searchQuery}
          filters={filters}
          detectionEvents={detectionEvents}
          onFiltersClick={() => setFiltersOpen(true)}
          onRefresh={() => void refreshFeed()}
        />
      )}
      <OverviewFiltersModal
        open={filtersOpen}
        filters={filters}
        tokens={tokens}
        eventOptions={feedMode === 'coins' ? coinEventOptions : detectionEventOptions}
        mode={feedMode}
        onClose={() => setFiltersOpen(false)}
        onApply={(nextFilters) => {
          setFilters(nextFilters);
          setFiltersOpen(false);
        }}
      />
    </div>
  );
}
