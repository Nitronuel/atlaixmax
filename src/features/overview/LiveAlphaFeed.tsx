import { ChevronLeft, ChevronRight, Info, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SiBnbchain, SiEthereum, SiOptimism, SiPolygon, SiTon } from 'react-icons/si';
import type { IconType } from 'react-icons';
import type { DetectionEvent } from '../../shared/detection';
import type { OverviewToken } from '../../shared/overview';
import { buildLatestDetectionEventLookup, detectionEventLabelForToken, latestDetectionEventForToken } from './overview-detection-events';
import {
  activeFilterCount,
  filterTokens,
  formatInteger,
  formatPercentValue,
  formatPrice,
  formatUsd,
  openToken,
  sortTokens,
  type OverviewFilters,
  type OverviewSortKey,
  type SortConfig,
  visibleLimit
} from './overview-utils';

const PAGE_SIZE = 24;
const chainLabels: Record<string, string> = {
  abstract: 'Abstract',
  arbitrum: 'Arbitrum',
  avalanche: 'Avalanche',
  base: 'Base',
  bsc: 'BNB Chain',
  ethereum: 'Ethereum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  solana: 'Solana',
  ton: 'TON'
};
const chainIcons: Partial<Record<string, IconType>> = {
  bsc: SiBnbchain,
  ethereum: SiEthereum,
  optimism: SiOptimism,
  polygon: SiPolygon,
  ton: SiTon
};
const chainLogoImages: Partial<Record<string, string>> = {
  base: '/chain-icons/base-square-blue.svg',
  solana: '/chain-icons/solana-logo.svg'
};

type FeedColumn = {
  label: string;
  key: OverviewSortKey;
  className?: string;
  width: number;
  align?: 'right';
};

const columns: FeedColumn[] = [
  { label: 'Chain', key: 'chain', className: 'chain-col', width: 78 },
  { label: 'Token', key: 'symbol', className: 'token-col', width: 190 },
  { label: 'Price', key: 'priceUsd', width: 122, align: 'right' },
  { label: 'Chg 24h', key: 'change24h', width: 116, align: 'right' },
  { label: 'MCap', key: 'marketCapUsd', width: 132, align: 'right' },
  { label: 'DEX Volume', key: 'volume24hUsd', width: 144, align: 'right' },
  { label: 'Liquidity', key: 'liquidityUsd', width: 136, align: 'right' },
  { label: 'DEX Buys', key: 'dexBuys24h', width: 116, align: 'right' },
  { label: 'DEX Sells', key: 'dexSells24h', width: 116, align: 'right' },
  { label: 'DEX Flow', key: 'dexFlow24h', width: 150, align: 'right' },
  { label: 'Event', key: 'event', width: 180 }
];

function ColGroup() {
  return (
    <colgroup>
      {columns.map((column) => (
        <col key={column.key} style={{ width: column.width }} />
      ))}
    </colgroup>
  );
}

function SortGlyph({ direction }: { direction?: 'asc' | 'desc' }) {
  return (
    <span className={['overview-sort-glyph', direction ? `is-${direction}` : ''].filter(Boolean).join(' ')} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function HeaderRow({ sortConfig, onSort }: { sortConfig: SortConfig; onSort: (key: OverviewSortKey) => void }) {
  return (
    <tr>
      {columns.map((column) => {
        const key = column.key;
        const active = sortConfig?.key === key;
        const direction = active ? sortConfig?.direction : undefined;
        return (
          <th
            key={key}
            className={[column.className || '', column.align === 'right' ? 'metric-col' : ''].filter(Boolean).join(' ')}
            aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            <button type="button" onClick={() => onSort(key)} className={active ? 'active' : ''}>
              {['Price', 'MCap', 'DEX Volume', 'Liquidity', 'DEX Buys', 'DEX Sells'].includes(column.label) ? <Info size={12} /> : null}
              {column.label}
              <SortGlyph direction={direction} />
            </button>
          </th>
        );
      })}
    </tr>
  );
}

function FlowBar({ value, max }: { value: number; max: number }) {
  const positive = value >= 0;
  const width = max > 0 ? Math.max(6, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
  return (
    <div className="overview-flow">
      <span className={positive ? 'positive' : 'negative'}>{value > 0 ? '+' : ''}{formatInteger(value)}</span>
      <div><i className={positive ? 'positive' : 'negative'} style={{ width: `${width}%` }} /></div>
    </div>
  );
}

function signedClass(value: number) {
  return value >= 0 ? 'positive' : 'negative';
}

function normalizeChainKey(chain: string) {
  const normalized = chain.trim().toLowerCase();
  if (['eth', 'ethereum'].includes(normalized)) return 'ethereum';
  if (['bnb', 'bsc', 'binance', 'binance smart chain'].includes(normalized)) return 'bsc';
  if (['sol', 'solana'].includes(normalized)) return 'solana';
  if (['poly', 'polygon'].includes(normalized)) return 'polygon';
  if (['arb', 'arbitrum'].includes(normalized)) return 'arbitrum';
  if (['op', 'optimism'].includes(normalized)) return 'optimism';
  if (['avax', 'avalanche'].includes(normalized)) return 'avalanche';
  return normalized || 'unknown';
}

function ChainLogo({ chain }: { chain: string }) {
  const key = normalizeChainKey(chain);
  const label = chainLabels[key] || chain || 'Unknown chain';
  const Icon = chainIcons[key];
  const image = chainLogoImages[key];
  return (
    <span className={`overview-token-chain-logo chain-${key}`} title={label} aria-label={`${label} chain`}>
      {image ? <img src={image} alt="" aria-hidden="true" /> : null}
      {Icon ? <Icon aria-hidden="true" /> : null}
      {key === 'arbitrum' && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2.8 20.1 7.4v9.2L12 21.2l-8.1-4.6V7.4L12 2.8Z" />
          <path className="chain-logo-light" d="m9.5 16.4 5.6-9.8 2 1.1-5.6 9.8-2-1.1Zm3.8 1.2 3.2-5.6 2 1.1-3.2 5.6-2-1.1Z" />
          <path className="chain-logo-accent" d="m6.2 14.8 5.6-9.7 2 1.1-5.6 9.8-2-1.2Z" />
        </svg>
      )}
      {key === 'avalanche' && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.4" />
          <path className="chain-logo-cutout" d="m12.1 6 5.4 9.4h-3.2l-2.2-3.8-2.2 3.8H6.7L12.1 6Zm3.1 9.4h2.3l-1.5-2.6-.8 1.4Z" />
        </svg>
      )}
      {key === 'abstract' && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.2 5.2h6.2v6.2H5.2V5.2Zm7.4 0h6.2v6.2h-6.2V5.2ZM5.2 12.6h6.2v6.2H5.2v-6.2Zm7.4 0h6.2v6.2h-6.2v-6.2Z" />
        </svg>
      )}
      {!image && !Icon && !['arbitrum', 'avalanche', 'abstract'].includes(key) && <span>{chain.slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}

export function LiveAlphaFeed({
  tokens,
  loading,
  error,
  lastUpdated,
  searchQuery,
  filters,
  detectionEvents,
  onFiltersClick,
  onRefresh
}: {
  tokens: OverviewToken[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  searchQuery: string;
  filters: OverviewFilters;
  detectionEvents: DetectionEvent[];
  onFiltersClick: () => void;
  onRefresh: () => void;
}) {
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [page, setPage] = useState(1);
  const feedRef = useRef<HTMLElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);
  const detectionEventLookup = useMemo(() => buildLatestDetectionEventLookup(detectionEvents), [detectionEvents]);
  const eventFiltered = useMemo(() => {
    const baseFilters = { ...filters, event: 'all' };
    return filterTokens(tokens, baseFilters, searchQuery).filter((token) => (
      filters.event === 'all' || detectionEventLabelForToken(detectionEventLookup, token) === filters.event
    ));
  }, [detectionEventLookup, filters, searchQuery, tokens]);
  const sorted = useMemo(() => {
    if (sortConfig?.key !== 'event') return sortTokens(eventFiltered, sortConfig);
    const multiplier = sortConfig.direction === 'asc' ? 1 : -1;
    return [...eventFiltered].sort((left, right) => (
      detectionEventLabelForToken(detectionEventLookup, left).localeCompare(detectionEventLabelForToken(detectionEventLookup, right)) * multiplier
    ));
  }, [detectionEventLookup, eventFiltered, sortConfig]);
  const limited = useMemo(() => sorted.slice(0, visibleLimit(filters, sorted.length)), [filters, sorted]);
  const totalPages = Math.max(1, Math.ceil(limited.length / PAGE_SIZE));
  const pageRows = useMemo(() => limited.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [limited, page]);
  const maxFlow = useMemo(() => Math.max(0, ...pageRows.map((token) => Math.abs(token.dexFlow24h))), [pageRows]);
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  useEffect(() => setPage(1), [filters, searchQuery, sortConfig]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    const head = headRef.current;
    if (!feed || !head) return undefined;
    const feedElement = feed;
    const headElement = head;

    function setHeadHeight() {
      feedElement.style.setProperty('--overview-feed-head-height', `${headElement.getBoundingClientRect().height}px`);
    }

    setHeadHeight();
    const resizeObserver = new ResizeObserver(setHeadHeight);
    resizeObserver.observe(headElement);
    window.addEventListener('resize', setHeadHeight);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', setHeadHeight);
    };
  }, []);

  function syncScroll(source: HTMLDivElement | null) {
    if (!source || syncing.current) return;
    syncing.current = true;
    const left = source.scrollLeft;
    [headerRef.current, tableRef.current, railRef.current].forEach((target) => {
      if (target && target !== source) target.scrollLeft = left;
    });
    window.requestAnimationFrame(() => {
      syncing.current = false;
    });
  }

  function toggleSort(key: OverviewSortKey) {
    setSortConfig((current) => {
      if (current?.key !== key) return { key, direction: 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
  }

  return (
    <section className="overview-feed" ref={feedRef}>
      <div className="overview-feed-head" ref={headRef}>
        <div>
          <h2>Live Alpha Feed <span>Live</span></h2>
          <p>{error && !tokens.length ? error : `Showing ${pageRows.length} of ${limited.length} tokens`}</p>
        </div>
        <div>
          <button type="button" className="overview-icon-action" onClick={onRefresh} aria-label="Refresh feed">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button type="button" className="overview-filter-button" onClick={onFiltersClick}>
            <SlidersHorizontal size={16} />
            Filters
            {activeFilterCount(filters) ? <b>{activeFilterCount(filters)}</b> : null}
          </button>
          <small>{lastUpdated ? `Last sync ${lastUpdated.toLocaleTimeString()}` : 'Waiting for sync'}</small>
        </div>
      </div>

      <div ref={headerRef} onScroll={() => syncScroll(headerRef.current)} className="overview-column-head">
        <table style={{ minWidth: tableWidth }}>
          <ColGroup />
          <thead><HeaderRow sortConfig={sortConfig} onSort={toggleSort} /></thead>
        </table>
      </div>

      <div ref={tableRef} onScroll={() => syncScroll(tableRef.current)} className="overview-table-wrap">
        {loading && !tokens.length ? (
          <div className="overview-table-state">
            <RefreshCw size={22} className="spin" />
            <span>Loading live tokens</span>
          </div>
        ) : !pageRows.length ? (
          <div className="overview-table-state">
            <span>{error || 'No tokens match the current filters.'}</span>
          </div>
        ) : (
          <table style={{ minWidth: tableWidth }}>
            <ColGroup />
            <tbody>
              {pageRows.map((token) => (
                <tr key={token.id} onClick={() => openToken(token)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && openToken(token)}>
                  <td className="chain-col">
                    <ChainLogo chain={token.chain} />
                  </td>
                  <td className="token-col">
                    <span className="overview-token-logo">{token.logo ? <img src={token.logo} alt="" /> : token.symbol.slice(0, 2)}</span>
                    <span>
                      <strong>{token.symbol}</strong>
                      <small>{token.name}</small>
                    </span>
                  </td>
                  <td className="metric-col">{formatPrice(token.priceUsd)}</td>
                  <td className={`metric-col ${signedClass(Number(token.change24h))}`}>{formatPercentValue(token.change24h)}</td>
                  <td className="metric-col">{formatUsd(token.marketCapUsd)}</td>
                  <td className="metric-col">{formatUsd(token.volume24hUsd)}</td>
                  <td className="metric-col">{formatUsd(token.liquidityUsd)}</td>
                  <td className="metric-col positive">{formatInteger(token.dexBuys24h)}</td>
                  <td className="metric-col negative">{formatInteger(token.dexSells24h)}</td>
                  <td className={`metric-col ${signedClass(token.dexFlow24h)}`}><FlowBar value={token.dexFlow24h} max={maxFlow} /></td>
                  <td>
                    {(() => {
                      const detectionEvent = latestDetectionEventForToken(detectionEventLookup, token);
                      return (
                        <span className={['overview-event-pill', !detectionEvent ? 'is-empty' : ''].filter(Boolean).join(' ')}>
                          {detectionEvent?.eventType || 'None'}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div ref={railRef} onScroll={() => syncScroll(railRef.current)} className="overview-table-rail" aria-label="Horizontal table scroll">
        <div style={{ width: tableWidth }} />
      </div>

      <div className="overview-pagination">
        <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
          <ChevronLeft size={16} /> Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages}>
          Next <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}
