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

const mobileColumns: CoinColumn[] = [
  { label: 'Rank', key: 'marketCapRank', className: 'chain-col', width: 44, align: 'right' },
  { label: 'Coin', key: 'symbol', className: 'token-col', width: 112 },
  { label: 'Price', key: 'priceUsd', width: 82, align: 'right' },
  { label: '24h', key: 'change24h', width: 72, align: 'right' },
  { label: 'MCap', key: 'marketCapUsd', width: 88, align: 'right' },
  { label: '24h Volume', key: 'volume24hUsd', width: 96, align: 'right' },
  { label: 'FDV', key: 'fdvUsd', width: 92, align: 'right' },
  { label: 'Circ. Supply', key: 'circulatingSupply', width: 98, align: 'right' },
  { label: 'Read', key: 'event', width: 112 }
];

function ColGroup({ tableColumns }: { tableColumns: CoinColumn[] }) {
  return (
    <colgroup>
      {tableColumns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
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

function HeaderRow({ tableColumns, sortConfig, onSort }: { tableColumns: CoinColumn[]; sortConfig: CoinSortConfig; onSort: (key: CoinSortKey) => void }) {
  return (
    <tr>
      {tableColumns.map((column) => {
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

function CoinLogo({ coin }: { coin: CoinGeckoCoin }) {
  return <span className="overview-token-logo">{coin.image ? <img src={coin.image} alt="" /> : coin.symbol.slice(0, 2)}</span>;
}

function CoinCell({ coin, column }: { coin: CoinGeckoCoin; column: CoinColumn }) {
  const cellClassName = [column.className || '', column.align === 'right' ? 'metric-col' : ''].filter(Boolean).join(' ');

  if (column.key === 'marketCapRank') return <td className={cellClassName}>#{coin.marketCapRank || 'N/A'}</td>;
  if (column.key === 'symbol') {
    return (
      <td className={cellClassName}>
        <CoinLogo coin={coin} />
        <span>
          <strong>{coin.symbol}</strong>
          <small>{coin.name}</small>
        </span>
      </td>
    );
  }
  if (column.key === 'priceUsd') return <td className={cellClassName}>{formatPrice(coin.priceUsd)}</td>;
  if (column.key === 'change1h') return <td className={`${cellClassName} ${signedClass(coin.change1h)}`}>{formatPercentValue(coin.change1h)}</td>;
  if (column.key === 'change24h') return <td className={`${cellClassName} ${signedClass(coin.change24h)}`}>{formatPercentValue(coin.change24h)}</td>;
  if (column.key === 'change7d') return <td className={`${cellClassName} ${signedClass(coin.change7d)}`}>{formatPercentValue(coin.change7d)}</td>;
  if (column.key === 'change30d') return <td className={`${cellClassName} ${signedClass(coin.change30d)}`}>{formatPercentValue(coin.change30d)}</td>;
  if (column.key === 'marketCapUsd') return <td className={cellClassName}>{formatUsd(coin.marketCapUsd)}</td>;
  if (column.key === 'volume24hUsd') return <td className={cellClassName}>{formatUsd(coin.volume24hUsd)}</td>;
  if (column.key === 'fdvUsd') return <td className={cellClassName}>{formatUsd(coin.fdvUsd)}</td>;
  if (column.key === 'circulatingSupply') return <td className={cellClassName}>{formatInteger(coin.circulatingSupply)}</td>;
  return <td className={cellClassName}><span className="overview-event-pill">{coin.event}</span></td>;
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
  const [isMobileTable, setIsMobileTable] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches);
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
  const tableColumns = isMobileTable ? mobileColumns : columns;
  const tableWidth = tableColumns.reduce((sum, column) => sum + column.width, 0);

  useEffect(() => setPage(1), [filters, searchQuery, sortConfig]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const update = () => setIsMobileTable(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

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
    <div className="overview-feed-layout">
      <section className="overview-feed" ref={feedRef}>
        <div className="overview-feed-head" ref={headRef}>
          <div>
            <h2>Live Market Feed <span>Coins</span></h2>
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
            <ColGroup tableColumns={tableColumns} />
            <thead><HeaderRow tableColumns={tableColumns} sortConfig={sortConfig} onSort={toggleSort} /></thead>
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
              <ColGroup tableColumns={tableColumns} />
              <tbody>
                {pageRows.map((coin) => (
                  <tr key={coin.id} onClick={() => openCoin(coin)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && openCoin(coin)}>
                    {tableColumns.map((column) => <CoinCell coin={coin} column={column} key={column.key} />)}
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
    </div>
  );
}
