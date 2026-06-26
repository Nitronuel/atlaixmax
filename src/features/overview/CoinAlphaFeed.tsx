import { ChevronLeft, ChevronRight, Info, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CoinGeckoCoin } from '../../shared/coingecko';
import { filterCoins, openCoin, sortCoins, type CoinSortConfig, type CoinSortKey } from './coin-feed-utils';
import { activeFilterCount, formatInteger, formatPercentValue, formatPrice, formatUsd, type OverviewFilters, visibleLimit } from './overview-utils';

const PAGE_SIZE = 50;

type CoinColumn = {
  label: string;
  key: CoinSortKey;
  className?: string;
  width: number;
  align?: 'right';
};

const columns: CoinColumn[] = [
  { label: 'Rank', key: 'marketCapRank', className: 'chain-col', width: 78, align: 'right' },
  { label: 'Coin', key: 'symbol', className: 'token-col', width: 170 },
  { label: 'Price', key: 'priceUsd', width: 122, align: 'right' },
  { label: '1h', key: 'change1h', width: 92, align: 'right' },
  { label: '24h', key: 'change24h', width: 96, align: 'right' },
  { label: '7d', key: 'change7d', width: 96, align: 'right' },
  { label: '30d', key: 'change30d', width: 100, align: 'right' },
  { label: 'MCap', key: 'marketCapUsd', width: 138, align: 'right' },
  { label: '24h Volume', key: 'volume24hUsd', width: 146, align: 'right' },
  { label: 'FDV', key: 'fdvUsd', width: 132, align: 'right' },
  { label: 'Circ. Supply', key: 'circulatingSupply', width: 146, align: 'right' },
  { label: 'Read', key: 'event', width: 170 }
];

function ColGroup() {
  return (
    <colgroup>
      {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
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

function HeaderRow({ sortConfig, onSort }: { sortConfig: CoinSortConfig; onSort: (key: CoinSortKey) => void }) {
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
              {['Price', 'MCap', '24h Volume', 'FDV'].includes(column.label) ? <Info size={12} /> : null}
              {column.label}
              <SortGlyph direction={direction} />
            </button>
          </th>
        );
      })}
    </tr>
  );
}

function signedClass(value: unknown) {
  return Number(value || 0) >= 0 ? 'positive' : 'negative';
}

export function CoinAlphaFeed({
  coins,
  loading,
  error,
  lastUpdated,
  searchQuery,
  filters,
  onFiltersClick,
  onRefresh
}: {
  coins: CoinGeckoCoin[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  searchQuery: string;
  filters: OverviewFilters;
  onFiltersClick: () => void;
  onRefresh: () => void;
}) {
  const [sortConfig, setSortConfig] = useState<CoinSortConfig>({ key: 'marketCapRank', direction: 'asc' });
  const [page, setPage] = useState(1);
  const feedRef = useRef<HTMLElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);
  const filtered = useMemo(() => filterCoins(coins, filters, searchQuery), [coins, filters, searchQuery]);
  const sorted = useMemo(() => sortCoins(filtered, sortConfig), [filtered, sortConfig]);
  const limited = useMemo(() => sorted.slice(0, visibleLimit(filters, sorted.length)), [filters, sorted]);
  const totalPages = Math.max(1, Math.ceil(limited.length / PAGE_SIZE));
  const pageRows = useMemo(() => limited.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [limited, page]);
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

  function toggleSort(key: CoinSortKey) {
    setSortConfig((current) => {
      if (current?.key !== key) return { key, direction: key === 'marketCapRank' ? 'asc' : 'desc' };
      if (current.direction === 'desc') return { key, direction: 'asc' };
      return null;
    });
  }

  return (
    <section className="overview-feed" ref={feedRef}>
      <div className="overview-feed-head" ref={headRef}>
        <div>
          <h2>Live Alpha Feed <span>Coins</span></h2>
          <p>{error && !coins.length ? error : `Showing ${pageRows.length} of ${limited.length} coins`}</p>
        </div>
        <div>
          <button type="button" className="overview-icon-action" onClick={onRefresh} aria-label="Refresh coin feed">
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
        {loading && !coins.length ? (
          <div className="overview-table-state">
            <RefreshCw size={22} className="spin" />
            <span>Loading coins</span>
          </div>
        ) : !pageRows.length ? (
          <div className="overview-table-state">
            <span>{error || 'No coins match the current filters.'}</span>
          </div>
        ) : (
          <table style={{ minWidth: tableWidth }}>
            <ColGroup />
            <tbody>
              {pageRows.map((coin) => (
                <tr key={coin.id} onClick={() => openCoin(coin)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && openCoin(coin)}>
                  <td className="chain-col metric-col">#{coin.marketCapRank || 'N/A'}</td>
                  <td className="token-col">
                    <span className="overview-token-logo">{coin.image ? <img src={coin.image} alt="" /> : coin.symbol.slice(0, 2)}</span>
                    <span>
                      <strong>{coin.symbol}</strong>
                      <small>{coin.name}</small>
                    </span>
                  </td>
                  <td className="metric-col">{formatPrice(coin.priceUsd)}</td>
                  <td className={`metric-col ${signedClass(coin.change1h)}`}>{formatPercentValue(coin.change1h)}</td>
                  <td className={`metric-col ${signedClass(coin.change24h)}`}>{formatPercentValue(coin.change24h)}</td>
                  <td className={`metric-col ${signedClass(coin.change7d)}`}>{formatPercentValue(coin.change7d)}</td>
                  <td className={`metric-col ${signedClass(coin.change30d)}`}>{formatPercentValue(coin.change30d)}</td>
                  <td className="metric-col">{formatUsd(coin.marketCapUsd)}</td>
                  <td className="metric-col">{formatUsd(coin.volume24hUsd)}</td>
                  <td className="metric-col">{formatUsd(coin.fdvUsd)}</td>
                  <td className="metric-col">{formatInteger(coin.circulatingSupply)}</td>
                  <td><span className="overview-event-pill">{coin.event}</span></td>
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
