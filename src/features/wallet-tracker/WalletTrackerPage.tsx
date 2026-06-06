import { ArrowLeft, Check, CheckCircle, ChevronDown, Clock, Globe, Loader2, Plus, RefreshCw, Search, Trash2, Wallet, X, Zap } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SavedWallet, WalletCategory, WalletChain, WalletTimeFilter } from './wallet-types';
import { useWalletPortfolio } from './useWalletPortfolio';
import { WalletStorage } from './wallet-storage';
import {
  formatTimeHeld,
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
    WalletStorage.ensure(nextAddress, chain);
    reloadWallets();
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
  const [chain, setChain] = useState<WalletChain>(() => normalizeWalletChain(searchParams.get('chain')) || detectedChain);
  const [timeFilter, setTimeFilter] = useState<WalletTimeFilter>('ALL');
  const [savedWallet, setSavedWallet] = useState<SavedWallet | null>(() => validation.isValid ? WalletStorage.ensure(address, chain) : null);
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

    const nextWallet = WalletStorage.ensure(address, compatibleChain);
    setSavedWallet(nextWallet);
    setName(nextWallet.name);
    setCategories(nextWallet.categories);
    setSearchParams({ chain: compatibleChain });
  }, [address, chain, detectedChain, setSearchParams, validation.isValid, validation.type]);

  useEffect(() => {
    if (!validation.isValid || portfolioState.loading) return;
    WalletStorage.updateStats(address, {
      balance: portfolioState.stats.netWorth,
      winRate: portfolioState.stats.winRate,
      pnl: portfolioState.stats.totalPnl
    });
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
                    <Link to={`/token/${asset.address}`}>
                      {asset.logo ? <img src={asset.logo} alt="" /> : <span>{asset.symbol.slice(0, 1)}</span>}
                      <strong>{asset.symbol}</strong>
                      <small>{asset.chain || 'Unknown'}</small>
                    </Link>
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
  const [chain, setChain] = useState<WalletChain>('All Chains');
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
