import { ChevronDown, Filter, RefreshCw, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DetectionEvent, DetectionSentiment } from '../../shared/detection';
import { detectionEventAssessmentForLabel } from '../../shared/detection-copy';
import { DetectionService } from './detection-service';

const CACHE_KEY = 'atlaix-detection-events-cache';

type DetectionFilters = {
  sentiment: DetectionSentiment | 'all';
  eventType: string;
  minVolume: number;
};

const defaultFilters: DetectionFilters = {
  sentiment: 'all',
  eventType: 'all',
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
  const tokenName = event.token.name || event.token.ticker || 'This token';
  const summary = detectionEventAssessmentForLabel(event.eventType, tokenName, event.summary);
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
    if (filters.eventType !== 'all' && event.eventType !== filters.eventType) return false;
    if (event.metrics.volume24h < filters.minVolume) return false;
    return true;
  });
}

function detectionTokenKey(event: DetectionEvent) {
  return [
    event.token.chain.trim().toLowerCase(),
    event.token.address.trim().toLowerCase() || event.token.pairAddress.trim().toLowerCase()
  ].join(':');
}

function latestEventsByToken(events: DetectionEvent[]) {
  const grouped = new Map<string, DetectionEvent[]>();
  events.forEach((event) => {
    const key = detectionTokenKey(event);
    grouped.set(key, [...(grouped.get(key) || []), event]);
  });
  return Array.from(grouped.values()).map((tokenEvents) => (
    [...tokenEvents].sort((left, right) => right.detectedAt - left.detectedAt)
  )).sort((left, right) => right[0].detectedAt - left[0].detectedAt);
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

function DetectionEventCard({ event, previousEvents }: { event: DetectionEvent; previousEvents: DetectionEvent[] }) {
  const cardRef = useRef<HTMLAnchorElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewPlacement, setPreviewPlacement] = useState<'above' | 'below'>('above');
  const sentimentLabel = event.sentiment.toUpperCase();
  const href = `/detection/token/${encodeURIComponent(event.token.chain)}/${encodeURIComponent(event.token.address)}?pair=${encodeURIComponent(event.token.pairAddress)}`;
  const tokenName = event.token.name || event.token.ticker || 'This token';
  const summary = detectionEventAssessmentForLabel(event.eventType, tokenName, event.summary);

  function updatePreviewPlacement() {
    const card = cardRef.current;
    const preview = previewRef.current;
    if (!card || !preview) return;

    const cardRect = card.getBoundingClientRect();
    const previewHeight = Math.min(preview.scrollHeight || 220, 220);
    const spacing = 18;
    const safeTop = 76;
    const safeBottom = 24;
    const roomAbove = cardRect.top - safeTop;
    const roomBelow = window.innerHeight - cardRect.bottom - safeBottom;
    setPreviewPlacement(roomBelow >= previewHeight + spacing || roomBelow > roomAbove ? 'below' : 'above');
  }

  return (
    <Link
      ref={cardRef}
      className={['detection-event-card', `sentiment-${event.sentiment}`, previousEvents.length ? 'has-history' : '', `is-preview-${previewPlacement}`].filter(Boolean).join(' ')}
      to={href}
      onMouseEnter={updatePreviewPlacement}
      onFocus={updatePreviewPlacement}
    >
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
          {previousEvents.length ? <span className="detection-history-count">+{previousEvents.length}</span> : null}
          <span className={`detection-sentiment sentiment-${event.sentiment}`}>{sentimentLabel}</span>
          <strong>{formatUsd(event.metrics.volume24h)}</strong>
        </div>
      </footer>
      {previousEvents.length ? (
        <div ref={previewRef} className="detection-event-preview" aria-label={`${event.token.ticker} previous detection events`}>
          <div>
            <strong>{event.token.ticker} history</strong>
            <span>{previousEvents.length} previous</span>
          </div>
          <ul>
            {previousEvents.map((previousEvent) => (
              <li key={previousEvent.id}>
                <span>{previousEvent.eventType}</span>
                <time dateTime={new Date(previousEvent.detectedAt).toISOString()}>{formatEventAge(previousEvent.detectedAt)}</time>
              </li>
            ))}
          </ul>
          <em>Open token page for full history</em>
        </div>
      ) : null}
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
  const detectionEventTypes = useMemo(() => (
    ['all', ...Array.from(new Set(events.map((event) => event.eventType).filter(Boolean))).sort()]
  ), [events]);
  const filteredEvents = useMemo(() => visibleEvents(events, submittedQuery || query, chain, filters), [chain, events, filters, query, submittedQuery]);
  const groupedEvents = useMemo(() => latestEventsByToken(filteredEvents), [filteredEvents]);
  const activeFilterCount = [
    filters.sentiment !== 'all',
    filters.eventType !== 'all',
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
          <span>{groupedEvents.length} tokens</span>
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
        ) : groupedEvents.length ? (
          <div className="detection-events-grid">
            {groupedEvents.map(([event, ...previousEvents]) => (
              <DetectionEventCard event={event} previousEvents={previousEvents} key={detectionTokenKey(event)} />
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
              label="Event type"
              value={filters.eventType}
              options={detectionEventTypes.map((eventType) => ({
                label: eventType === 'all' ? 'All events' : eventType,
                value: eventType
              }))}
              onChange={(eventType) => setFilters((current) => ({ ...current, eventType }))}
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
