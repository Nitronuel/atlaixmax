import { ChevronLeft, ChevronRight, Info, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { OverviewToken } from '../../shared/overview';
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
const columns: Array<{ label: string; key: OverviewSortKey; className?: string; width: number; align?: 'right' }> = [
  { label: 'Chain Token', key: 'symbol', className: 'token-col', width: 230 },
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
        const active = sortConfig?.key === column.key;
        const direction = active ? sortConfig?.direction : undefined;
        return (
          <th
            key={column.key}
            className={[column.className || '', column.align === 'right' ? 'metric-col' : ''].filter(Boolean).join(' ')}
            aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            <button type="button" onClick={() => onSort(column.key)} className={active ? 'active' : ''}>
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

export function LiveAlphaFeed({
  tokens,
  loading,
  error,
  lastUpdated,
  searchQuery,
  filters,
  onFiltersClick,
  onRefresh
}: {
  tokens: OverviewToken[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  searchQuery: string;
  filters: OverviewFilters;
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
  const filtered = useMemo(() => filterTokens(tokens, filters, searchQuery), [filters, searchQuery, tokens]);
  const sorted = useMemo(() => sortTokens(filtered, sortConfig), [filtered, sortConfig]);
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
                  <td className="token-col">
                    <span className="overview-token-logo">{token.logo ? <img src={token.logo} alt="" /> : token.symbol.slice(0, 2)}</span>
                    <span>
                      <strong>{token.symbol}</strong>
                      <small>{token.chain} / {token.name}</small>
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
                  <td><span className="overview-event-pill">{token.event}</span></td>
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
