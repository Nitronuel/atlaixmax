import { Activity, ArrowLeft, ArrowUpRight, ChevronDown, Filter, Layers, Loader2, Search, ShieldCheck, TrendingUp, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { buildWalletStats, evaluateSmartMoney, shortAddress } from '../wallet-tracker/wallet-utils';
import { WalletPortfolioService } from '../wallet-tracker/wallet-service';
import { WalletStorage } from '../wallet-tracker/wallet-storage';
import type { SavedWallet, WalletAsset, WalletChain, WalletPortfolio } from '../wallet-tracker/wallet-types';
import { SmartMoneyService } from './smart-money-service';

type SmartTokenAggregate = {
  id: string;
  ticker: string;
  name: string;
  amount: string;
  count: number;
  image?: string;
  chain?: WalletChain;
};

type SmartWalletEvent = {
  id: string;
  type: 'buy' | 'sell';
  wallet: string;
  walletAddress: string;
  token: string;
  tokenAddress: string;
  amount: string;
  time: string;
};

const STABLE_TOKEN_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'USDS', 'TUSD']);
const CHAIN_FILTERS: Array<{ id: 'all' | 'solana' | 'ethereum' | 'base'; label: string }> = [
  { id: 'all', label: 'All Chains' },
  { id: 'solana', label: 'Solana' },
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'base', label: 'Base' }
];
const TIME_RANGES = ['1h', '4h', '24h', '7d'] as const;
type TimeRange = (typeof TIME_RANGES)[number];

function compactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function getWalletDisplayName(wallet: SavedWallet) {
  return wallet.name.replace(/^Tracked\s+/i, '').trim() || shortAddress(wallet.addr);
}

function walletInitial(wallet: SavedWallet) {
  return getWalletDisplayName(wallet).slice(0, 1).toUpperCase();
}

function matchesChain(chain: WalletChain | undefined, filter: string) {
  if (filter === 'all') return true;
  return (chain || '').toLowerCase() === filter;
}

function eventTime(asset: WalletAsset) {
  if (!asset.buyTime) return 'Recent';
  const minutes = Math.max(1, Math.floor((Date.now() - asset.buyTime) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function timeRangeMs(range: TimeRange) {
  if (range === '1h') return 60 * 60_000;
  if (range === '4h') return 4 * 60 * 60_000;
  if (range === '7d') return 7 * 24 * 60 * 60_000;
  return 24 * 60 * 60_000;
}

function smartWallets() {
  return WalletStorage.list()
    .filter((wallet) => wallet.qualification?.qualified)
    .sort((a, b) => (b.qualification?.score || 0) - (a.qualification?.score || 0));
}

async function loadWalletPortfolio(wallet: SavedWallet) {
  try {
    const portfolio = await WalletPortfolioService.getPortfolio(wallet.addr, wallet.chain, 'ALL');
    return { wallet, portfolio };
  } catch {
    return null;
  }
}

function buildAggregates(entries: Array<{ wallet: SavedWallet; portfolio: WalletPortfolio }>, chainFilter: string, query: string) {
  const holdings = new Map<string, {
    ticker: string;
    name: string;
    totalUsd: number;
    walletSet: Set<string>;
    image?: string;
    address: string;
    chain?: WalletChain;
  }>();

  entries.forEach(({ wallet, portfolio }) => {
    portfolio.assets
      .filter((asset) => asset.rawValue > 25)
      .filter((asset) => matchesChain(asset.chain || wallet.chain, chainFilter))
      .forEach((asset) => {
        const key = `${asset.chain || wallet.chain}:${asset.address}`.toLowerCase();
        const existing = holdings.get(key);
        if (existing) {
          existing.totalUsd += asset.rawValue;
          existing.walletSet.add(wallet.addr);
          return;
        }
        holdings.set(key, {
          ticker: asset.symbol,
          name: asset.symbol,
          totalUsd: asset.rawValue,
          walletSet: new Set([wallet.addr]),
          image: asset.logo,
          address: asset.address,
          chain: asset.chain || wallet.chain
        });
      });
  });

  return [...holdings.values()]
    .filter((token) => !STABLE_TOKEN_SYMBOLS.has(token.ticker.toUpperCase()))
    .filter((token) => !query || `${token.ticker} ${token.name}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 4)
    .map((token): SmartTokenAggregate => ({
      id: token.address,
      ticker: token.ticker,
      name: token.name,
      amount: compactUsd(token.totalUsd),
      count: token.walletSet.size,
      image: token.image,
      chain: token.chain
    }));
}

function buildEvents(entries: Array<{ wallet: SavedWallet; portfolio: WalletPortfolio }>, chainFilter: string, query: string, range: TimeRange) {
  const cutoff = Date.now() - timeRangeMs(range);
  return entries.flatMap(({ wallet, portfolio }) =>
    portfolio.assets
      .filter((asset) => asset.rawValue > 25 && asset.buyTime && asset.buyTime >= cutoff)
      .filter((asset) => matchesChain(asset.chain || wallet.chain, chainFilter))
      .filter((asset) => !query || asset.symbol.toLowerCase().includes(query.toLowerCase()))
      .map((asset): SmartWalletEvent => ({
        id: `${wallet.addr}:${asset.chain || wallet.chain}:${asset.address}`,
        type: 'buy',
        wallet: shortAddress(wallet.addr),
        walletAddress: wallet.addr,
        token: asset.symbol,
        tokenAddress: asset.address,
        amount: asset.value,
        time: eventTime(asset)
      }))
  ).slice(0, 8);
}

export function SmartMoneyPage() {
  const { address } = useParams();
  return address ? <SmartWalletProfile address={address} /> : <SmartMoneyDashboard />;
}

function SmartMoneyDashboard() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [chain, setChain] = useState<(typeof CHAIN_FILTERS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [wallets, setWallets] = useState<SavedWallet[]>(() => smartWallets());
  const [walletSource, setWalletSource] = useState<'database' | 'local'>('local');
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [portfolios, setPortfolios] = useState<Array<{ wallet: SavedWallet; portfolio: WalletPortfolio }>>([]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingWallets(true);
    SmartMoneyService.listWallets(controller.signal)
      .then((databaseWallets) => {
        if (!controller.signal.aborted && databaseWallets.length) {
          setWallets(databaseWallets);
          setWalletSource('database');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWallets(smartWallets());
          setWalletSource('local');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingWallets(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!wallets.length) {
      setPortfolios([]);
      return undefined;
    }

    setLoadingWallets(true);
    Promise.all(wallets.slice(0, 8).map(loadWalletPortfolio))
      .then((results) => {
        if (!cancelled) setPortfolios(results.filter((entry): entry is { wallet: SavedWallet; portfolio: WalletPortfolio } => Boolean(entry)));
      })
      .finally(() => {
        if (!cancelled) setLoadingWallets(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wallets]);

  const visibleWallets = useMemo(() => wallets.filter((wallet) => {
    const chainMatch = chain === 'all' || wallet.chain.toLowerCase() === chain || wallet.chain === 'All Chains';
    const queryMatch = !query || `${wallet.name} ${wallet.addr}`.toLowerCase().includes(query.toLowerCase());
    return chainMatch && queryMatch;
  }), [chain, query, wallets]);
  const topInflows = useMemo(() => buildAggregates(portfolios, chain, query), [chain, portfolios, query]);
  const recentEvents = useMemo(() => buildEvents(portfolios, chain, query, timeRange), [chain, portfolios, query, timeRange]);
  const currentChain = CHAIN_FILTERS.find((item) => item.id === chain)?.label || 'All Chains';

  return (
    <div className="smart-money-page">
      <section className="smart-money-filter-bar">
        <div className="smart-filter-left">
          <button type="button" onClick={() => {
            const index = CHAIN_FILTERS.findIndex((item) => item.id === chain);
            setChain(CHAIN_FILTERS[(index + 1) % CHAIN_FILTERS.length].id);
          }}>
            <Layers size={16} />
            {currentChain}
            <ChevronDown size={14} />
          </button>
          <div className="smart-time-tabs" role="group" aria-label="Smart Money time range">
            {TIME_RANGES.map((range) => (
              <button key={range} type="button" className={timeRange === range ? 'active' : ''} onClick={() => setTimeRange(range)}>
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="smart-filter-right">
          <label className="smart-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token..." />
          </label>
          <button type="button" onClick={() => {
            setChain('all');
            setTimeRange('24h');
            setQuery('');
          }}>
            <Filter size={16} />
            <span>Reset</span>
          </button>
        </div>
      </section>

      <section className="smart-money-grid">
        <div className="smart-column">
          <section className="smart-panel smart-wallet-panel">
            <header>
              <div>
                <span><Wallet size={18} /></span>
                <div>
                  <h2>Trending Smart Wallets</h2>
                  <p>Qualified wallet signals across score, PnL and tracked capital.</p>
                </div>
              </div>
              <b>{loadingWallets ? 'Live' : `${visibleWallets.length} ${walletSource === 'database' ? 'global' : 'local'}`}</b>
            </header>
            <div className="smart-wallet-list">
              {loadingWallets && !visibleWallets.length ? <SmartLoading label="Loading smart wallets" /> : null}
              {!loadingWallets && !visibleWallets.length ? <SmartEmpty title="No qualified wallets yet" body="Track wallets from Wallet Intelligence and strong performers will appear here automatically." /> : null}
              {visibleWallets.slice(0, 5).map((wallet) => (
                <button key={wallet.addr} type="button" className="smart-wallet-card" onClick={() => navigate(`/smart-money/${wallet.addr}`)}>
                  <div className="smart-wallet-card-head">
                    <span className="smart-wallet-avatar">{walletInitial(wallet)}</span>
                    <div>
                      <strong>{getWalletDisplayName(wallet)}</strong>
                      <small>{shortAddress(wallet.addr)} <em>{wallet.chain}</em></small>
                    </div>
                    <i><ArrowUpRight size={16} /></i>
                  </div>
                  <dl>
                    <div><dt>Win</dt><dd>{wallet.lastWinRate || 'No data'}</dd></div>
                    <div><dt>Score</dt><dd>{wallet.qualification?.score || 0}/100</dd></div>
                    <div><dt>PnL</dt><dd>{wallet.lastPnl || 'No data'}</dd></div>
                    <div><dt>Capital</dt><dd>{wallet.lastBalance || 'No data'}</dd></div>
                  </dl>
                </button>
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => navigate('/wallet')}>See more <ArrowUpRight size={16} /></button>
            </footer>
          </section>
        </div>

        <div className="smart-column">
          <section className="smart-panel smart-events-panel">
            <header>
              <h2><Activity size={18} /> Smart Money Events</h2>
              <span>Updates as wallets move</span>
            </header>
            <div className="smart-event-list">
              {!loadingWallets && !recentEvents.length ? <SmartEmpty title="No recent activity" body="Buy activity from qualified wallets will appear here when wallet history is available." /> : null}
              {recentEvents.map((event) => (
                <button key={event.id} type="button" className={`smart-event-row ${event.type}`} onClick={() => navigate(`/token/${event.tokenAddress}`)}>
                  <span />
                  <div>
                    <strong>{event.type === 'buy' ? 'Buy' : 'Sell'}</strong>
                    <b>{event.token}</b>
                    <small>{event.time}</small>
                  </div>
                  <div>
                    <small>{event.wallet}</small>
                    <b>{event.amount}</b>
                  </div>
                </button>
              ))}
            </div>
            <footer>
              <button type="button" onClick={() => navigate('/wallet')}>View Wallet Activity</button>
            </footer>
          </section>
        </div>

        <div className="smart-column smart-flow-column">
          <SmartTokenPanel title="Smart Money Top Inflows" tokens={topInflows} tone="inflow" emptyTitle="No inflows yet" emptyBody="Overlapping positions from qualified wallets will appear here." />
          <SmartTokenPanel title="Smart Money Selling / Outflow" tokens={[]} tone="outflow" emptyTitle="No sell pressure yet" emptyBody="Confirmed selling from qualified wallets will appear here when trade exits are available." />
        </div>
      </section>
    </div>
  );
}

function SmartTokenPanel({ title, tokens, tone, emptyTitle, emptyBody }: {
  title: string;
  tokens: SmartTokenAggregate[];
  tone: 'inflow' | 'outflow';
  emptyTitle: string;
  emptyBody: string;
}) {
  const navigate = useNavigate();
  return (
    <section className={`smart-panel smart-token-panel ${tone}`}>
      <header><h2>{title}</h2></header>
      <div className="smart-token-list">
        {!tokens.length ? <SmartEmpty title={emptyTitle} body={emptyBody} /> : null}
        {tokens.map((token) => (
          <button key={`${token.chain || 'chain'}:${token.id}`} type="button" onClick={() => navigate(`/token/${token.id}`)}>
            <span className="smart-token-logo">{token.image ? <img src={token.image} alt="" /> : token.ticker.slice(0, 1)}</span>
            <span>
              <strong>{token.ticker}</strong>
              <small>{tone === 'inflow' ? 'Net inflow' : 'Net outflow'}</small>
            </span>
            <span>
              <strong>{token.amount}</strong>
              <small>{token.count} smart wallets</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SmartWalletProfile({ address }: { address: string }) {
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<SavedWallet | null>(() => WalletStorage.get(address) || null);
  const chain = wallet?.chain || 'All Chains';
  const [portfolio, setPortfolio] = useState<WalletPortfolio | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const localWallet = WalletStorage.get(address);
    setWallet(localWallet || null);
    if (localWallet) return undefined;

    const controller = new AbortController();
    SmartMoneyService.listWallets(controller.signal)
      .then((wallets) => {
        if (controller.signal.aborted) return;
        setWallet(wallets.find((item) => item.addr.toLowerCase() === address.toLowerCase()) || null);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    WalletPortfolioService.getPortfolio(address, chain, 'ALL')
      .then((next) => {
        if (!cancelled) setPortfolio(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, chain]);

  const stats = useMemo(() => portfolio ? buildWalletStats(portfolio.assets, portfolio.netWorth) : null, [portfolio]);
  const qualification = wallet?.qualification || (stats ? evaluateSmartMoney(stats) : null);
  const activePositions = useMemo(() => (portfolio?.assets || []).filter((asset) => asset.rawValue > 1).sort((a, b) => b.rawValue - a.rawValue), [portfolio]);

  return (
    <div className="smart-money-page smart-profile-page">
      <button className="smart-back-button" type="button" onClick={() => navigate(-1)}>
        <ArrowLeft size={20} />
        Back
      </button>
      <section className="smart-profile-hero">
        <div>
          <span><Wallet size={24} /></span>
          <div>
            <p>Smart Money Wallet</p>
            <h2>{wallet?.name || `Smart Wallet ${shortAddress(address)}`}</h2>
            <small>{address}</small>
          </div>
        </div>
        <dl>
          <div><dt>Score</dt><dd>{qualification?.score || 0}/100</dd></div>
          <div><dt>Qualified</dt><dd className={qualification?.qualified ? 'positive' : 'negative'}>{qualification?.qualified ? 'Yes' : 'No'}</dd></div>
          <div><dt>Status</dt><dd>{loading ? <Loader2 size={16} className="spin" /> : 'Live'}</dd></div>
          <div><dt>Joined</dt><dd>{wallet?.timestamp ? new Date(wallet.timestamp).toLocaleDateString('en-GB') : 'Recently added'}</dd></div>
        </dl>
      </section>
      <section className="smart-profile-reasons" aria-label="Smart Money qualification reasons">
        {qualification?.reasons.length ? qualification.reasons.map((reason: string) => (
          <span key={reason}>{reason}</span>
        )) : (
          <span>Awaiting enough wallet performance data.</span>
        )}
      </section>
      <section className="smart-profile-stats">
        <SmartMetric title="Smart score" value={`${qualification?.score || 0}/100`} icon={<ShieldCheck size={42} />} />
        <SmartMetric title="Win rate" value={wallet?.lastWinRate || 'N/A'} icon={<TrendingUp size={42} />} />
        <SmartMetric title="Total PnL" value={wallet?.lastPnl || 'N/A'} icon={<TrendingUp size={42} />} />
        <SmartMetric title="Net worth" value={portfolio?.netWorth || wallet?.lastBalance || '$0.00'} icon={<Wallet size={42} />} />
        <SmartMetric title="Positions" value={String(activePositions.length)} icon={<Activity size={42} />} />
        <SmartMetric title="Main chain" value={chain} icon={<Layers size={42} />} />
      </section>
      <section className="smart-panel smart-profile-table">
        <header>
          <h2>Wallet Portfolio (Active Positions)</h2>
          <span>{loading ? 'Refreshing live wallet data...' : `${activePositions.length} active positions`}</span>
        </header>
        <div>
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Position</th>
                <th>Current Price</th>
                <th>Unrealized PnL</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !activePositions.length ? (
                <tr><td colSpan={5}>No active token positions were found for this wallet right now.</td></tr>
              ) : null}
              {activePositions.map((asset) => (
                <tr key={`${asset.chain || chain}:${asset.address}`} onClick={() => navigate(`/token/${asset.address}`)}>
                  <td><span className="smart-token-logo">{asset.logo ? <img src={asset.logo} alt="" /> : asset.symbol.slice(0, 1)}</span><strong>{asset.symbol}</strong><small>{asset.chain || chain}</small></td>
                  <td><strong>{asset.value}</strong><small>{asset.balance}</small></td>
                  <td><strong>{asset.price}</strong><small>Entry unavailable</small></td>
                  <td className={asset.pnlPercent && asset.pnlPercent > 0 ? 'positive' : asset.pnlPercent && asset.pnlPercent < 0 ? 'negative' : ''}><strong>{asset.pnl || 'N/A'}</strong><small>{asset.pnlPercent !== undefined ? `${asset.pnlPercent.toFixed(2)}%` : 'PnL pending'}</small></td>
                  <td><span>{asset.pnlPercent !== undefined && asset.pnlPercent >= 25 ? 'High' : asset.pnlPercent !== undefined && asset.pnlPercent > 0 ? 'Medium' : 'Low'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SmartMetric({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <div>
      <span>{title}</span>
      <strong>{value}</strong>
      {icon}
    </div>
  );
}

function SmartLoading({ label }: { label: string }) {
  return <div className="smart-loading"><Loader2 size={16} className="spin" /> {label}</div>;
}

function SmartEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="smart-empty">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
