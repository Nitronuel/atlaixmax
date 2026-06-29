import { Activity, ChevronDown, ChevronRight, Filter, PieChart, RefreshCw, Search, SlidersHorizontal, Target, X } from 'lucide-react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DetectionEvent, DetectionSentiment } from '../../shared/detection';
import { detectionEventAssessmentForLabel, detectionEventTableCopyForLabel } from '../../shared/detection-copy';
import { DetectionService } from './detection-service';

const CACHE_KEY = 'atlaix-detection-events-cache';
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const tableCopy = detectionEventTableCopyForLabel(event.eventType, event.summary);
  return [
    event.eventType,
    tableCopy.title,
    tableCopy.description,
    tableCopy.type,
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

function detectionEventHref(event: DetectionEvent) {
  return `/detection/token/${encodeURIComponent(event.token.chain)}/${encodeURIComponent(event.token.address)}?pair=${encodeURIComponent(event.token.pairAddress)}`;
}

function recentDetectionInsights(events: DetectionEvent[]) {
  const cutoff = Date.now() - DAY_MS;
  const recentEvents = events.filter((event) => event.detectedAt >= cutoff);
  const eventTypeCounts = new Map<string, number>();
  const tokenKeys = new Set<string>();

  recentEvents.forEach((event) => {
    const tableCopy = detectionEventTableCopyForLabel(event.eventType, event.summary);
    eventTypeCounts.set(tableCopy.type, (eventTypeCounts.get(tableCopy.type) || 0) + 1);
    tokenKeys.add(detectionTokenKey(event));
  });

  const topEventType = Array.from(eventTypeCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || null;

  return {
    topEventType: topEventType ? topEventType[0] : 'No activity',
    topEventCount: topEventType ? topEventType[1] : 0,
    recentEventCount: recentEvents.length,
    recentTokenCount: tokenKeys.size
  };
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

function DetectionMetricCard({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="detection-insight-card">
      <span className="detection-insight-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function DetectionEventRow({ event }: { event: DetectionEvent }) {
  const navigate = useNavigate();
  const href = detectionEventHref(event);
  const tableCopy = detectionEventTableCopyForLabel(event.eventType, event.summary);
  const tokenLabel = event.token.ticker || event.token.name || 'Token';
  const tokenName = event.token.name || tokenLabel;
  const previewCopy = detectionEventAssessmentForLabel(event.eventType, tokenName, event.summary);

  function openEvent() {
    navigate(href);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openEvent();
  }

  return (
    <tr className={`detection-event-row sentiment-${event.sentiment}`} onClick={openEvent} onKeyDown={handleKeyDown} tabIndex={0}>
      <td>
        <div className="detection-event-cell">
          <strong>{tableCopy.title}</strong>
          <small>{tableCopy.description}</small>
          <div className={`detection-row-preview sentiment-${event.sentiment}`} role="tooltip">
            <header>
              <span>{tableCopy.type}</span>
              <time dateTime={new Date(event.detectedAt).toISOString()}>{formatEventAge(event.detectedAt)}</time>
            </header>
            <strong>{tokenName}</strong>
            <p>{previewCopy}</p>
          </div>
        </div>
      </td>
      <td>
        <div className="detection-token">
          {event.token.logo ? <img src={event.token.logo} alt="" /> : <span className="detection-token-fallback">{tokenLabel.slice(0, 2).toUpperCase()}</span>}
          <span>
            <strong>{tokenLabel}</strong>
            <small>{event.token.name && event.token.name !== tokenLabel ? event.token.name : shortAddress(event.token.address)}</small>
          </span>
        </div>
      </td>
      <td><span className="detection-chain-pill">{event.token.chain}</span></td>
      <td><span className={`detection-type-pill sentiment-${event.sentiment}`}>{tableCopy.type}</span></td>
      <td><time dateTime={new Date(event.detectedAt).toISOString()}>{formatEventAge(event.detectedAt)}</time></td>
      <td>
        <Link className="detection-row-action" to={href} onClick={(event) => event.stopPropagation()} aria-label={`Open ${tokenLabel} detection details`}>
          <ChevronRight size={17} />
        </Link>
      </td>
    </tr>
  );
}

function shortAddress(value: string) {
  if (!value) return 'No address';
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
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
  const insights = useMemo(() => recentDetectionInsights(filteredEvents), [filteredEvents]);
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

      <div className="detection-events-layout">
        <section className="detection-events-panel" aria-labelledby="detection-events-title">
          <div className="detection-events-head">
            <div>
              <h2 id="detection-events-title">Events</h2>
              <p>Latest activity across detected tokens.</p>
            </div>
            <div className="detection-events-head-actions">
              <span className="detection-events-count">{filteredEvents.length} events</span>
            </div>
          </div>
          <div className="detection-events-body">
            <div className="detection-events-main">
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
                <div className="detection-table-wrap">
                  <table className="detection-table">
                    <thead>
                      <tr>
                        <th>Event</th>
                        <th>Token</th>
                        <th>Chain</th>
                        <th>Type</th>
                        <th>Time</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((event) => (
                        <DetectionEventRow event={event} key={event.id || detectionTokenKey(event)} />
                      ))}
                    </tbody>
                  </table>
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
            </div>
          </div>
        </section>

        <aside className="detection-insights-rail" aria-label="24 hour detection summary">
          <DetectionMetricCard
            icon={<PieChart size={18} />}
            label="Top event type"
            value={insights.topEventType}
            detail={`${insights.topEventCount} events in 24h`}
          />
          <DetectionMetricCard
            icon={<Activity size={18} />}
            label="24h events"
            value={String(insights.recentEventCount)}
            detail="Visible activity in this view"
          />
          <DetectionMetricCard
            icon={<Target size={18} />}
            label="24h tokens detected"
            value={String(insights.recentTokenCount)}
            detail="Unique tokens with events"
          />
        </aside>
      </div>

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
