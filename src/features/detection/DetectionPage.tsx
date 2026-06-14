import { ChevronDown, Filter, RefreshCw, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DetectionEvent, DetectionSentiment, DetectionSeverity } from '../../shared/detection';
import { detectionEventSummaryForLabel } from '../../shared/detection-copy';
import { DetectionService } from './detection-service';

const CACHE_KEY = 'atlaix-detection-events-cache';

type DetectionFilters = {
  sentiment: DetectionSentiment | 'all';
  severity: DetectionSeverity | 'all';
  minVolume: number;
};

const defaultFilters: DetectionFilters = {
  sentiment: 'all',
  severity: 'all',
  minVolume: 0
};

function formatUsd(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatEventAge(timestamp: number) {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsedMs / (60 * 1000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function matchesQuery(event: DetectionEvent, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const summary = detectionEventSummaryForLabel(event.eventType, event.summary);
  return [
    event.eventType,
    summary,
    event.summary,
    event.token.name,
    event.token.ticker,
    event.token.address,
    event.token.chain,
    event.token.pairAddress
  ].some((value) => value.toLowerCase().includes(normalized));
}

function visibleEvents(events: DetectionEvent[], query: string, chain: string, filters: DetectionFilters) {
  return events.filter((event) => {
    if (!matchesQuery(event, query)) return false;
    if (chain !== 'All Chains' && event.token.chain !== chain) return false;
    if (filters.sentiment !== 'all' && event.sentiment !== filters.sentiment) return false;
    if (filters.severity !== 'all' && event.severity !== filters.severity) return false;
    if (event.metrics.volume24h < filters.minVolume) return false;
    return true;
  });
}

function cacheEvents(events: DetectionEvent[]) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ data: events, timestamp: Date.now() }));
  } catch {
    // Snapshot cache is best-effort.
  }
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="detection-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function DetectionEventCard({ event }: { event: DetectionEvent }) {
  const sentimentLabel = event.sentiment.toUpperCase();
  const href = `/detection/token/${encodeURIComponent(event.token.chain)}/${encodeURIComponent(event.token.address)}?pair=${encodeURIComponent(event.token.pairAddress)}`;
  const summary = detectionEventSummaryForLabel(event.eventType, event.summary);

  return (
    <Link className={`detection-event-card sentiment-${event.sentiment}`} to={href}>
      <header>
        <div>
          <ShieldCheck size={15} />
          <strong>{event.eventType}</strong>
        </div>
        <time dateTime={new Date(event.detectedAt).toISOString()}>{formatEventAge(event.detectedAt)}</time>
      </header>
      <p>{summary}</p>
      <footer>
        <div className="detection-token">
          {event.token.logo ? <img src={event.token.logo} alt="" /> : <span className="detection-token-fallback">{event.token.ticker.slice(0, 2).toUpperCase()}</span>}
          <span>{event.token.ticker}</span>
        </div>
        <div className="detection-card-metrics">
          <span className={`detection-sentiment sentiment-${event.sentiment}`}>{sentimentLabel}</span>
          <strong>{formatUsd(event.metrics.volume24h)}</strong>
        </div>
      </footer>
    </Link>
  );
}

export function DetectionPage() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [chain, setChain] = useState('All Chains');
  const [filters, setFilters] = useState<DetectionFilters>(defaultFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectionChains = useMemo(() => ['All Chains', ...Array.from(new Set(events.map((event) => event.token.chain).filter(Boolean)))], [events]);
  const filteredEvents = useMemo(() => visibleEvents(events, submittedQuery || query, chain, filters), [chain, events, filters, query, submittedQuery]);
  const activeFilterCount = [
    filters.sentiment !== 'all',
    filters.severity !== 'all',
    filters.minVolume > 0
  ].filter(Boolean).length;

  async function loadEvents(showLoading = true) {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const response = await DetectionService.getEvents();
      setEvents(response.events);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Detection Engine events are unavailable.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents();
  }, []);

  useEffect(() => {
    cacheEvents(filteredEvents);
  }, [filteredEvents]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
  }

  async function refreshEvents() {
    setRefreshing(true);
    try {
      await loadEvents(false);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="detection-page" aria-labelledby="detection-events-title">
      <form className="detection-search-panel" onSubmit={submitSearch}>
        <label className="detection-search-control">
          <Search size={23} />
          <span className="sr-only">Search detections</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSubmittedQuery('');
            }}
            placeholder="Search any token, symbol, or address..."
          />
        </label>
        <button className="detection-search-button" type="submit">Search</button>
        <label className="detection-chain-select">
          <span className="sr-only">Chain</span>
          <select value={chain} onChange={(event) => setChain(event.target.value)}>
            {detectionChains.map((nextChain) => (
              <option key={nextChain} value={nextChain}>{nextChain}</option>
            ))}
          </select>
          <ChevronDown size={17} />
        </label>
      </form>

      <div className="detection-actions">
        <button className="detection-secondary-button" type="button" onClick={() => setFiltersOpen(true)}>
          <Filter size={18} />
          <span>Filter</span>
          {activeFilterCount ? <b>{activeFilterCount}</b> : null}
        </button>
        <button className="detection-secondary-button" type="button" onClick={() => void refreshEvents()} disabled={refreshing || loading}>
          <RefreshCw size={18} className={refreshing ? 'is-spinning' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      <section className="detection-events-panel" aria-labelledby="detection-events-title">
        <div className="detection-events-head">
          <div>
            <h2 id="detection-events-title">Events</h2>
            <p>Latest activity across detected tokens.</p>
          </div>
          <span>{filteredEvents.length} visible</span>
        </div>
        {loading ? (
          <div className="detection-empty">
            <RefreshCw size={24} className="is-spinning" />
            <strong>Loading detection events.</strong>
          </div>
        ) : error ? (
          <div className="detection-empty">
            <SlidersHorizontal size={24} />
            <strong>{error}</strong>
            <button type="button" onClick={() => void refreshEvents()}>Retry</button>
          </div>
        ) : filteredEvents.length ? (
          <div className="detection-events-grid">
            {filteredEvents.map((event) => (
              <DetectionEventCard event={event} key={event.id} />
            ))}
          </div>
        ) : (
          <div className="detection-empty">
            <SlidersHorizontal size={24} />
            <strong>{events.length ? 'No detections match these filters.' : 'No detection events available yet.'}</strong>
            <button type="button" onClick={() => {
              setQuery('');
              setSubmittedQuery('');
              setChain('All Chains');
              setFilters(defaultFilters);
            }}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      {filtersOpen ? (
        <div className="detection-filter-backdrop" role="dialog" aria-modal="true" aria-label="Detection filters">
          <button className="detection-filter-scrim" type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" />
          <div className="detection-filter-panel">
            <header>
              <div>
                <strong>Filters</strong>
                <span>Refine visible detections.</span>
              </div>
              <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                <X size={19} />
              </button>
            </header>
            <FilterSelect
              label="Sentiment"
              value={filters.sentiment}
              options={[
                { label: 'All sentiment', value: 'all' },
                { label: 'Bullish', value: 'bullish' },
                { label: 'Bearish', value: 'bearish' },
                { label: 'Neutral', value: 'neutral' }
              ]}
              onChange={(sentiment) => setFilters((current) => ({ ...current, sentiment }))}
            />
            <FilterSelect
              label="Severity"
              value={filters.severity}
              options={[
                { label: 'All severity', value: 'all' },
                { label: 'Critical', value: 'critical' },
                { label: 'High', value: 'high' },
                { label: 'Medium', value: 'medium' },
                { label: 'Low', value: 'low' }
              ]}
              onChange={(severity) => setFilters((current) => ({ ...current, severity }))}
            />
            <label className="detection-filter-field">
              <span>Minimum 24h volume</span>
              <input
                type="range"
                min="0"
                max="1500000"
                step="100000"
                value={filters.minVolume}
                onChange={(event) => setFilters((current) => ({ ...current, minVolume: Number(event.target.value) }))}
              />
              <em>{formatUsd(filters.minVolume)}</em>
            </label>
            <div className="detection-filter-actions">
              <button type="button" onClick={() => setFilters(defaultFilters)}>Reset</button>
              <button type="button" onClick={() => setFiltersOpen(false)}>Apply</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
