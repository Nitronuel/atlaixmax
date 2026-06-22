import { ArrowLeft, ArrowUpRight, Check, CheckCircle, ChevronDown, Clock, ExternalLink, Globe, Loader2, Plus, RefreshCw, Search, Trash2, Wallet, X, Zap } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SmartMoneyService } from '../smart-money/smart-money-service';
import type { SavedWallet, WalletActivity, WalletActivityItem, WalletActivityToken, WalletCategory, WalletChain, WalletTimeFilter, WalletTradedToken } from './wallet-types';
import { useWalletActivity } from './useWalletActivity';
import { useWalletPortfolio } from './useWalletPortfolio';
import { WalletStorage } from './wallet-storage';
import {
  formatTimeHeld,
  evaluateSmartMoney,
  getDefaultChain,
  isChainCompatible,
  normalizeWalletChain,
  shortAddress,
  validateWalletAddress,
  WALLET_CATEGORIES,
  WALLET_CHAINS,
  walletNameFor
} from './wallet-utils';

const TIME_FILTERS: Array<{ value: WalletTimeFilter; label: string }> = [
  { value: 'ALL', label: 'All Time' },
  { value: '1D', label: '24h' },
  { value: '1W', label: '7d' },
  { value: '1M', label: '30d' },
  { value: '>1M', label: '>30d' }
];

const WALLET_FILTERS = ['All Types', 'Smart Money', 'Whale', 'Sniper', 'Fresh Wallet'] as const;

function timeFilterLabel(value: WalletTimeFilter) {
  if (value === 'ALL') return 'All Time';
  if (value === '1D') return 'Last 24h';
  if (value === '1W') return 'Last 7d';
  if (value === '1M') return 'Last 30d';
  return '> 30d';
}

const TOKEN_DETAILS_CHAINS: Partial<Record<WalletChain, string>> = {
  Ethereum: 'ethereum',
  Solana: 'solana',
  Base: 'base',
  BSC: 'bsc',
  Arbitrum: 'arbitrum',
  Optimism: 'optimism',
  Polygon: 'polygon',
  Avalanche: 'avalanche'
};

const NATIVE_TOKEN_ADDRESSES: Partial<Record<WalletChain, string>> = {
  Ethereum: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  Base: '0x4200000000000000000000000000000000000006',
  BSC: '0xbb4CdB9CBd36B01dCbaEBF2De08d9173bc095c',
  Arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  Optimism: '0x4200000000000000000000000000000000000006',
  Polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  Avalanche: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
};

function tokenDetailsPath(asset: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number]) {
  const chain = asset.chain || 'All Chains';
  const tokenChain = TOKEN_DETAILS_CHAINS[chain];
  if (!tokenChain) return '';

  const address = asset.address.includes(':native')
    ? NATIVE_TOKEN_ADDRESSES[chain]
    : asset.address;
  if (!address) return '';

  const params = new URLSearchParams({ chain: tokenChain });
  return `/token/${encodeURIComponent(address)}?${params.toString()}`;
}

function activityTokenDetailsPath(token: WalletActivityToken, chain: WalletChain) {
  const tokenChain = TOKEN_DETAILS_CHAINS[chain];
  if (!tokenChain || !token.address || token.address.includes(':native')) return '';

  const params = new URLSearchParams({ chain: tokenChain });
  return `/token/${encodeURIComponent(token.address)}?${params.toString()}`;
}

function formatActivityTime(timestamp: number) {
  if (!timestamp) return 'No timestamp';
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatExactActivityTime(timestamp: number) {
  return timestamp ? new Date(timestamp).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'No timestamp';
}

function formatActivityUsd(value: number | undefined) {
  if (!value) return 'N/A';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 1 ? 0 : 2 });
}

function trimFormattedDecimal(value: string) {
  return value.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

function formatActivityTokenAmount(amount: string) {
  const normalized = amount.replace(/,/g, '').trim();
  const value = Number(normalized);
  if (!Number.isFinite(value)) return amount;

  const absolute = Math.abs(value);
  if (absolute === 0) return '0';
  if (absolute >= 1_000_000) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  }
  if (absolute >= 10_000) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  }
  if (absolute >= 1_000) {
    return trimFormattedDecimal(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value));
  }
  if (absolute >= 1) {
    return trimFormattedDecimal(new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value));
  }

  const sign = value < 0 ? '-' : '';
  const fraction = normalized.replace('-', '').split('.')[1] || '';
  const leadingZeros = fraction.match(/^0*/)?.[0].length || 0;
  const fractionDigits = Math.min(12, leadingZeros + 4);
  return `${sign}${trimFormattedDecimal(absolute.toFixed(fractionDigits))}`;
}

function formatActivityNumberText(text: string) {
  return text.replace(/(?<![\w.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?![\w.])/g, (match) => formatActivityTokenAmount(match));
}

function parseActivityAmount(amount?: string) {
  if (!amount) return 0;
  const value = Number(amount.replace(/,/g, '').trim());
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function tokenPerformanceKey(token: WalletActivityToken | WalletTradedToken, chain: WalletChain) {
  return `${chain}:${token.address || token.symbol}`.toLowerCase();
}

function tokenPerformanceLabel(token: WalletActivityToken | WalletTradedToken) {
  return {
    address: token.address,
    symbol: token.symbol,
    logo: token.logo
  };
}

function formatPerformanceUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
}

function formatPerformanceReturn(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function buildTradePerformanceRows(activity: WalletActivity) {
  const rows = new Map<string, {
    token: ReturnType<typeof tokenPerformanceLabel>;
    boughtQty: number;
    soldQty: number;
    cost: number;
    proceeds: number;
    lastActivityAt: number;
  }>();

  function getRow(token: WalletActivityToken, chain: WalletChain, timestamp: number) {
    const key = tokenPerformanceKey(token, chain);
    const current = rows.get(key) || {
      token: tokenPerformanceLabel(token),
      boughtQty: 0,
      soldQty: 0,
      cost: 0,
      proceeds: 0,
      lastActivityAt: 0
    };
    current.lastActivityAt = Math.max(current.lastActivityAt, timestamp);
    rows.set(key, current);
    return current;
  }

  activity.activities.forEach((item) => {
    const value = item.usdValue || 0;
    if (!value) return;

    if (item.kind === 'buy' && item.tokenOut) {
      const row = getRow(item.tokenOut, item.chain, item.timestamp);
      row.boughtQty += parseActivityAmount(item.tokenOut.amount);
      row.cost += value;
    }

    if (item.kind === 'sell' && item.tokenIn) {
      const row = getRow(item.tokenIn, item.chain, item.timestamp);
      row.soldQty += parseActivityAmount(item.tokenIn.amount);
      row.proceeds += value;
    }

    if (item.kind === 'swap') {
      if (item.tokenIn) {
        const row = getRow(item.tokenIn, item.chain, item.timestamp);
        row.soldQty += parseActivityAmount(item.tokenIn.amount);
        row.proceeds += value;
      }
      if (item.tokenOut) {
        const row = getRow(item.tokenOut, item.chain, item.timestamp);
        row.boughtQty += parseActivityAmount(item.tokenOut.amount);
        row.cost += value;
      }
    }
  });

  return Array.from(rows.values())
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((row) => {
      const hasMatchedTrade = row.cost > 0 && row.proceeds > 0;
      const realizedPnl = hasMatchedTrade ? row.proceeds - row.cost : undefined;
      const returnPct = hasMatchedTrade && row.cost ? ((row.proceeds - row.cost) / row.cost) * 100 : undefined;
      const remainingQty = row.boughtQty - row.soldQty;
      const status = !hasMatchedTrade
        ? row.proceeds > 0 ? 'No basis' : 'Open'
        : remainingQty > Math.max(row.boughtQty * 0.05, 0.000001) ? 'Partial' : 'Closed';

      return {
        token: row.token,
        realizedPnl,
        returnPct,
        status
      };
    });
}

function activityTone(kind: WalletActivityItem['kind']) {
  if (kind === 'buy' || kind === 'receive') return 'positive';
  if (kind === 'sell' || kind === 'send') return 'negative';
  if (kind === 'approval') return 'warning';
  return 'neutral';
}

export function WalletTrackerPage() {
  const { address } = useParams();
  return address ? <WalletProfile address={address} /> : <WalletDashboard />;
}

function WalletDashboard() {
  const navigate = useNavigate();
  const [wallets, setWallets] = useState(() => WalletStorage.list());
  const [query, setQuery] = useState('');
  const [chainFilter, setChainFilter] = useState<WalletChain>('All Chains');
  const [typeFilter, setTypeFilter] = useState<(typeof WALLET_FILTERS)[number]>('All Types');
  const [pendingAddress, setPendingAddress] = useState('');
  const [error, setError] = useState('');
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const filteredWallets = useMemo(() => wallets.filter((wallet) => {
    const matchesChain = chainFilter === 'All Chains' || wallet.chain === chainFilter || wallet.chain === 'All Chains';
    const matchesType = typeFilter === 'All Types' || wallet.categories.includes(typeFilter as WalletCategory);
    const matchesQuery = !query || wallet.name.toLowerCase().includes(query.toLowerCase()) || wallet.addr.toLowerCase().includes(query.toLowerCase());
    return matchesChain && matchesType && matchesQuery;
  }), [wallets, chainFilter, typeFilter, query]);

  function reloadWallets() {
    setWallets(WalletStorage.list());
  }

  function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateWalletAddress(query);
    if (!result.isValid) {
      setError(result.error);
      return;
    }

    setError('');
    if (result.type === 'evm') {
      setPendingAddress(result.normalizedAddress);
      setChainModalOpen(true);
      return;
    }

    openWallet(result.normalizedAddress, 'Solana');
  }

  function openWallet(nextAddress: string, chain: WalletChain) {
    navigate(`/wallet/${nextAddress}?chain=${encodeURIComponent(chain)}`);
  }

  return (
    <div className="wallet-page wallet-dashboard-page">
      <section className="wallet-dashboard-search-card">
        <p>Track wallet's assets, performance and history</p>
        <form className="wallet-dashboard-search" onSubmit={submitAddress}>
          <Search size={22} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              if (error) setError('');
            }}
            placeholder="Search wallet address..."
          />
          <button type="submit">Track</button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="wallet-dashboard-filters" aria-label="Wallet filters">
        <label className="wallet-filter-pill">
          <Globe size={18} />
          <select value={chainFilter} onChange={(event) => setChainFilter(normalizeWalletChain(event.target.value))} aria-label="Filter chain">
            {WALLET_CHAINS.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
          </select>
          <ChevronDown size={15} />
        </label>
        <label className="wallet-filter-pill">
          <Zap size={18} />
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as (typeof WALLET_FILTERS)[number])} aria-label="Filter wallet type">
            {WALLET_FILTERS.map((filter) => <option key={filter} value={filter}>{filter}</option>)}
          </select>
          <ChevronDown size={15} />
        </label>
      </section>

      <section className="wallet-watchlist-section">
        <h2>Watchlist</h2>
        <section className="wallet-card-grid">
          {filteredWallets.map((wallet) => (
            <WalletCard key={wallet.addr} wallet={wallet} onDelete={() => {
              WalletStorage.delete(wallet.addr);
              reloadWallets();
            }} />
          ))}
          <button className="wallet-add-tile" type="button" onClick={() => setAddModalOpen(true)}>
            <span>
              <Plus size={30} />
            </span>
            <strong>Add New Wallet</strong>
          </button>
        </section>
      </section>

      <ChainSelectionModal
        open={chainModalOpen}
        onClose={() => setChainModalOpen(false)}
        onSelect={(chain) => {
          setChainModalOpen(false);
          openWallet(pendingAddress, chain);
        }}
      />
      <AddWalletModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdded={(wallet) => {
          reloadWallets();
          navigate(`/wallet/${wallet.addr}?chain=${encodeURIComponent(wallet.chain)}`);
        }}
      />
    </div>
  );
}

function WalletProfile({ address }: { address: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const validation = validateWalletAddress(address);
  const detectedChain = getDefaultChain(validation.type);
  const [chain, setChain] = useState<WalletChain>(() => searchParams.get('chain') ? normalizeWalletChain(searchParams.get('chain')) : detectedChain);
  const [timeFilter, setTimeFilter] = useState<WalletTimeFilter>('ALL');
  const [savedWallet, setSavedWallet] = useState<SavedWallet | null>(() => validation.isValid ? WalletStorage.get(address) || null : null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(savedWallet?.name || walletNameFor(address));
  const [categories, setCategories] = useState<WalletCategory[]>(savedWallet?.categories || []);
  const portfolioState = useWalletPortfolio(validation.isValid ? address : undefined, chain, timeFilter);
  const incompatibleChain = validation.isValid && !isChainCompatible(chain, validation.type);

  useEffect(() => {
    if (!validation.isValid) return;
    const compatibleChain = isChainCompatible(chain, validation.type) ? chain : detectedChain;
    if (compatibleChain !== chain) {
      setChain(compatibleChain);
      return;
    }

    const nextWallet = WalletStorage.get(address) || null;
    setSavedWallet(nextWallet);
    setName(nextWallet?.name || walletNameFor(address));
    setCategories(nextWallet?.categories || []);
    setSearchParams({ chain: compatibleChain });
  }, [address, chain, detectedChain, setSearchParams, validation.isValid, validation.type]);

  useEffect(() => {
    if (!validation.isValid || portfolioState.loading) return;
    const qualification = evaluateSmartMoney(portfolioState.stats);
    WalletStorage.updateStats(address, {
      balance: portfolioState.stats.netWorth,
      winRate: portfolioState.stats.winRate,
      pnl: portfolioState.stats.totalPnl,
      qualification
    });
    const wallet = WalletStorage.get(address);
    if (wallet) {
      SmartMoneyService.promoteWallet(wallet).catch(() => undefined);
    }
  }, [address, portfolioState.loading, portfolioState.stats, validation.isValid]);

  function saveProfile() {
    const next = WalletStorage.save(address, name, categories, chain);
    setSavedWallet(next);
    setEditing(false);
  }

  if (!validation.isValid) {
    return (
      <div className="wallet-page">
        <section className="wallet-empty-state">
          <Wallet size={28} />
          <h3>Invalid wallet address</h3>
          <p>{validation.error}</p>
          <button type="button" onClick={() => navigate('/wallet')}>Back to wallets</button>
        </section>
      </div>
    );
  }

  return (
    <div className="wallet-page wallet-result-page">
      <section className="wallet-result-top">
        <button className="wallet-back-link" type="button" onClick={() => navigate('/wallet')}>
          <ArrowLeft size={17} />
          Back to Wallets
        </button>
        <div className="wallet-result-controls">
          <label className="wallet-result-pill">
            <Clock size={17} />
            <select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value as WalletTimeFilter)} aria-label="Time period">
              {TIME_FILTERS.map((item) => <option key={item.value} value={item.value}>{timeFilterLabel(item.value)}</option>)}
            </select>
            <ChevronDown size={15} />
          </label>
          <label className="wallet-result-pill">
            <Globe size={17} />
            <select value={chain} onChange={(event) => setChain(normalizeWalletChain(event.target.value))} aria-label="Wallet chain">
              {WALLET_CHAINS.filter((item) => validation.type !== 'solana' || item.id === 'Solana').map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
        </div>
      </section>

      {incompatibleChain ? <p className="form-error">This wallet address is not compatible with {chain}.</p> : null}
      {portfolioState.error ? <p className="form-error">{portfolioState.error}</p> : null}

      <section className="wallet-result-layout">
        <aside className="wallet-result-card">
          {editing ? (
            <div className="wallet-edit-panel">
              <label>
                <span>Wallet Name</span>
                <input className="wallet-name-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Wallet name" />
              </label>
              <label>
                <span>Categories</span>
                <div className="category-row">
                  {WALLET_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      className={categories.includes(category) ? 'selected' : ''}
                      onClick={() => setCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category])}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </label>
              <div className="wallet-edit-actions">
                <button className="primary-action" type="button" onClick={saveProfile}><Check size={17} /> Save Profile</button>
                <button className="quiet-button" type="button" onClick={() => setEditing(false)}><X size={17} /> Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h2>{savedWallet?.name || name}</h2>
              <div className="category-row wallet-result-categories">
                {categories.length ? categories.map((category) => <span key={category}>{category}</span>) : <span>Uncategorized</span>}
              </div>
              <div className="wallet-address-pill">
                <span>{address}</span>
                <CheckCircle size={14} />
              </div>
              <div className="wallet-result-actions">
                <button className="quiet-button" type="button" onClick={() => setEditing(true)}>Edit Profile</button>
                {savedWallet ? (
                  <button className="quiet-button danger icon-only" type="button" onClick={() => {
                    WalletStorage.delete(address);
                    navigate('/wallet');
                  }} aria-label="Stop tracking wallet">
                    <Trash2 size={17} />
                  </button>
                ) : null}
              </div>
            </>
          )}
          <WalletStatsGrid loading={portfolioState.loading} stats={portfolioState.stats} />
        </aside>

        <HoldingsTable
          assets={portfolioState.portfolio.assets}
          loading={portfolioState.loading}
          message={portfolioState.portfolio.message}
          timeFilter={timeFilter}
          onRefresh={portfolioState.refreshPortfolio}
        />
      </section>

      <WalletActivityPanel address={address} chain={chain} timeFilter={timeFilter} />
    </div>
  );
}

function WalletCard({ wallet, onDelete }: { wallet: SavedWallet; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <article className="wallet-card">
      <div className="wallet-card-head">
        <span><Wallet size={19} /></span>
        <div>
          <h3>{wallet.name}</h3>
          <p>{wallet.chain}</p>
        </div>
      </div>
      <p className="wallet-address">{shortAddress(wallet.addr)}</p>
      <div className="category-row compact">
        {wallet.categories.slice(0, 3).map((category) => <span key={category}>{category}</span>)}
        {wallet.categories.length > 3 ? <span>+{wallet.categories.length - 3}</span> : null}
        {!wallet.categories.length ? <span>Uncategorized</span> : null}
      </div>
      <dl className="wallet-card-metrics">
        <div><dt>Balance</dt><dd>{wallet.lastBalance || 'N/A'}</dd></div>
        <div><dt>Win Rate</dt><dd>{wallet.lastWinRate || 'N/A'}</dd></div>
        <div><dt>PnL</dt><dd>{wallet.lastPnl || 'N/A'}</dd></div>
      </dl>
      <div className="wallet-card-actions">
        <Link to={`/wallet/${wallet.addr}?chain=${encodeURIComponent(wallet.chain)}`}>View portfolio</Link>
        {confirmDelete ? (
          <span className="confirm-delete">
            <button type="button" onClick={() => setConfirmDelete(false)} aria-label="Cancel delete"><X size={16} /></button>
            <button type="button" onClick={onDelete} aria-label="Delete wallet"><Check size={16} /></button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete wallet"><Trash2 size={16} /></button>
        )}
      </div>
    </article>
  );
}

function WalletStatsGrid({ stats, loading }: { stats: ReturnType<typeof useWalletPortfolio>['stats']; loading: boolean }) {
  const items = [
    ['Net Worth', stats.netWorth],
    ['Win Rate', stats.winRate],
    ['Total PnL', stats.totalPnl],
    ['Active Positions', stats.activePositions],
    ['Profitable Positions', stats.profitablePositions],
    ['Avg Hold Time', stats.avgHoldTime]
  ];

  return (
    <section className="wallet-stats-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{loading ? <Loader2 size={18} className="spin" /> : value}</strong>
        </div>
      ))}
    </section>
  );
}

function HoldingsTable({ assets, loading, message, timeFilter, onRefresh }: {
  assets: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'];
  loading: boolean;
  message?: string;
  timeFilter: WalletTimeFilter;
  onRefresh: () => void;
}) {
  const [showSmallBalances, setShowSmallBalances] = useState(false);
  const rows = useMemo(() => assets
    .filter((asset) => showSmallBalances || asset.rawValue >= 1)
    .sort((a, b) => b.rawValue - a.rawValue), [assets, showSmallBalances]);

  return (
    <section className="holdings-panel">
      <div className="holdings-head">
        <div>
          <h3>Current Holdings</h3>
          <p>{rows.length} visible positions</p>
        </div>
        <div>
          <button className="quiet-button" type="button" onClick={() => setShowSmallBalances((current) => !current)}>
            {showSmallBalances ? 'Hide small balances' : 'Show small balances'}
          </button>
          <button className="icon-button" type="button" onClick={onRefresh} aria-label="Refresh holdings">
            {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          </button>
        </div>
      </div>

      {rows.length ? (
        <div className="wallet-table-wrap">
          <table className="wallet-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Balance</th>
                <th>Value</th>
                <th>{timeFilter === 'ALL' ? 'PnL' : `${timeFilter} PnL`}</th>
                <th>Time Held</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((asset) => (
                <tr key={`${asset.chain || 'chain'}:${asset.address}`}>
                  <td>
                    <TokenAssetLink asset={asset} />
                  </td>
                  <td>{asset.balance}</td>
                  <td>{asset.value}</td>
                  <td className={asset.pnlPercent && asset.pnlPercent > 0 ? 'positive' : asset.pnlPercent && asset.pnlPercent < 0 ? 'negative' : ''}>{asset.pnl || 'N/A'}</td>
                  <td>{formatTimeHeld(asset.buyTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="holdings-empty">
          {loading ? <Loader2 size={22} className="spin" /> : <Wallet size={24} />}
          <h4>{loading ? 'Loading holdings' : 'No visible holdings'}</h4>
          <p>{loading ? 'Checking wallet balances.' : message || 'No token balances found for this wallet and chain.'}</p>
        </div>
      )}
    </section>
  );
}

function WalletActivityPanel({ address, chain, timeFilter }: { address: string; chain: WalletChain; timeFilter: WalletTimeFilter }) {
  const [requested, setRequested] = useState(true);
  const { activity, loading, error, refreshActivity } = useWalletActivity(address, chain, timeFilter, 'all', requested);
  const rows = activity.activities;

  function loadActivity() {
    if (requested) {
      refreshActivity();
      return;
    }
    setRequested(true);
  }

  return (
    <section className="wallet-activity-shell">
      <section className="wallet-activity-panel">
        <div className="wallet-activity-head">
          <div>
            <h3>Wallet Activity</h3>
          </div>
          <button className="icon-button" type="button" onClick={loadActivity} aria-label="Refresh wallet activity">
            {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {requested ? (
          <div className="wallet-activity-table-wrap">
            {rows.length ? (
              <table className="wallet-activity-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Time</th>
                    <th>Action</th>
                    <th>Token Flow</th>
                    <th>Value</th>
                    <th>Links</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => <ActivityTableRow key={item.id} item={item} />)}
                </tbody>
              </table>
            ) : (
              <div className="holdings-empty wallet-activity-empty">
                {loading ? <Loader2 size={22} className="spin" /> : <Wallet size={24} />}
                <h4>{loading ? 'Loading activity' : 'No activity found'}</h4>
                <p>{loading ? 'Checking decoded history, swaps, and transfers.' : activity.message || 'No wallet actions matched this filter and time period.'}</p>
              </div>
            )}
          </div>
        ) : null}
      </section>
      {requested ? <TradePerformancePanel activity={activity} /> : null}
    </section>
  );
}

function TradePerformancePanel({ activity }: { activity: WalletActivity }) {
  const rows = buildTradePerformanceRows(activity);

  return (
    <aside className="wallet-performance-panel">
      <header>
        <h4>Trade History</h4>
        <span>{rows.length}</span>
      </header>
      {rows.length ? rows.map((row) => (
        <div className="wallet-performance-card" key={`${row.token.address || row.token.symbol}:${row.status}`}>
          <div className="wallet-performance-main">
            <span className="wallet-performance-token">
              {row.token.logo ? <img src={row.token.logo} alt="" /> : <i>{row.token.symbol.slice(0, 1)}</i>}
              <strong>{row.token.symbol}</strong>
            </span>
          </div>
          <small>
            <span className={row.realizedPnl && row.realizedPnl > 0 ? 'positive' : row.realizedPnl && row.realizedPnl < 0 ? 'negative' : ''}>{formatPerformanceUsd(row.realizedPnl)}</span>
            <span className={row.returnPct && row.returnPct > 0 ? 'positive' : row.returnPct && row.returnPct < 0 ? 'negative' : ''}>({formatPerformanceReturn(row.returnPct)})</span>
          </small>
          <span className={`wallet-performance-status ${row.status.toLowerCase().replace(' ', '-')}`}>{row.status}</span>
        </div>
      )) : (
        <p>No completed trade data yet.</p>
      )}
    </aside>
  );
}

function ActivityTableRow({ item }: { item: WalletActivityItem }) {
  const targetToken = item.kind === 'buy' ? item.tokenOut : item.kind === 'sell' ? item.tokenIn : item.tokens[0];
  const tokenPath = targetToken ? activityTokenDetailsPath(targetToken, item.chain) : '';

  return (
    <tr className={`wallet-activity-table-row ${activityTone(item.kind)}`}>
      <td><span className="wallet-activity-kind">{item.kind}</span></td>
      <td title={formatExactActivityTime(item.timestamp)}>{formatActivityTime(item.timestamp)}</td>
      <td>
        <strong>{item.title}</strong>
        <small>{formatActivityNumberText(item.summary)}</small>
      </td>
      <td><ActivityTokenFlow item={item} /></td>
      <td className="wallet-activity-amount">{formatActivityUsd(item.usdValue)}</td>
      <td>
        <div className="wallet-activity-links">
          {tokenPath ? <Link to={tokenPath} aria-label="Open token details" title="Open token details"><ArrowUpRight size={15} /></Link> : null}
          {item.explorerUrl ? <a href={item.explorerUrl} target="_blank" rel="noreferrer" aria-label="Open transaction in explorer" title="Open transaction in explorer"><ExternalLink size={15} /></a> : null}
        </div>
      </td>
    </tr>
  );
}

function ActivityTokenFlow({ item }: { item: WalletActivityItem }) {
  if (item.tokenIn && item.tokenOut) {
    return (
      <span className="wallet-activity-token-flow">
        <ActivityTokenChip token={item.tokenIn} />
        <ArrowUpRight size={13} />
        <ActivityTokenChip token={item.tokenOut} />
      </span>
    );
  }

  if (!item.tokens.length) return <span className="wallet-activity-token-flow muted">N/A</span>;

  return (
    <span className="wallet-activity-token-flow">
      {item.tokens.slice(0, 2).map((token) => <ActivityTokenChip key={`${token.address || token.symbol}:${token.amount || ''}`} token={token} />)}
      {item.tokens.length > 2 ? <em>+{item.tokens.length - 2}</em> : null}
    </span>
  );
}

function ActivityTokenChip({ token }: { token: WalletActivityToken }) {
  return (
    <span className="wallet-activity-token-chip" title={token.name || token.symbol}>
      {token.logo ? <img src={token.logo} alt="" /> : <i>{token.symbol.slice(0, 1)}</i>}
      <span>{token.amount ? `${formatActivityTokenAmount(token.amount)} ` : ''}{token.symbol}</span>
    </span>
  );
}

function TokenAssetLink({ asset }: { asset: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number] }) {
  const content = (
    <>
      {asset.logo ? <img src={asset.logo} alt="" /> : <span>{asset.symbol.slice(0, 1)}</span>}
      <strong>{asset.symbol}</strong>
      <small>{asset.chain || 'Unknown'}</small>
    </>
  );
  const path = tokenDetailsPath(asset);

  return path ? <Link to={path}>{content}</Link> : <span>{content}</span>;
}

function ChainSelectionModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (chain: WalletChain) => void }) {
  const [query, setQuery] = useState('');
  const chains = WALLET_CHAINS.filter((chain) => chain.id !== 'Solana' && !chain.aggregate)
    .filter((chain) => `${chain.name} ${chain.symbol}`.toLowerCase().includes(query.toLowerCase()));

  if (!open) return null;

  return (
    <div className="wallet-modal-layer" role="dialog" aria-modal="true" aria-label="Select chain">
      <div className="wallet-modal">
        <div className="wallet-modal-head">
          <h3>Select chain</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="modal-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chain" autoFocus />
        </label>
        <div className="chain-list">
          {chains.map((chain) => (
            <button key={chain.id} type="button" onClick={() => onSelect(chain.id)}>
              <span>{chain.name}</span>
              <small>{chain.symbol}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddWalletModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (wallet: SavedWallet) => void }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState<WalletChain>('Ethereum');
  const [error, setError] = useState('');

  if (!open) return null;

  function addWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateWalletAddress(address);
    if (!validation.isValid) {
      setError(validation.error);
      return;
    }

    const nextChain = validation.type === 'solana' ? 'Solana' : chain;
    if (!isChainCompatible(nextChain, validation.type)) {
      setError('Choose a chain that matches this wallet address.');
      return;
    }

    const wallet = WalletStorage.save(validation.normalizedAddress, name || walletNameFor(validation.normalizedAddress), [], nextChain);
    setName('');
    setAddress('');
    setChain('All Chains');
    setError('');
    onAdded(wallet);
    onClose();
  }

  return (
    <div className="wallet-modal-layer" role="dialog" aria-modal="true" aria-label="Add wallet">
      <form className="wallet-modal" onSubmit={addWallet}>
        <div className="wallet-modal-head">
          <h3>Add wallet</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label>
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Wallet name" />
        </label>
        <label>
          <span>Address</span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="0x... or Solana address" />
        </label>
        <label>
          <span>Chain</span>
          <select value={chain} onChange={(event) => setChain(normalizeWalletChain(event.target.value))}>
            {WALLET_CHAINS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-action" type="submit">Add wallet</button>
      </form>
    </div>
  );
}
