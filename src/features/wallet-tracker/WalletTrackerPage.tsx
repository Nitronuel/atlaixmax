import { ArrowLeft, ArrowUpRight, Bell, Check, CheckCircle, ChevronDown, Clock, ExternalLink, Globe, Loader2, Plus, RefreshCw, Search, Trash2, Wallet, X, Zap } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SmartAlertService, type SmartAlertRule, type WalletAlertEventType } from '../smart-alerts/smart-alert-service';
import { SmartMoneyService } from '../smart-money/smart-money-service';
import { TelegramService } from '../../services/TelegramService';
import type { SavedWallet, WalletActivity, WalletActivityItem, WalletActivityToken, WalletCategory, WalletChain, WalletPnlSummary, WalletPortfolio, WalletTimeFilter, WalletTradedToken, WalletTradePerformance } from './wallet-types';
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
const WALLET_ALERT_EVENT_OPTIONS: Array<{ value: WalletAlertEventType; label: string }> = [
  { value: 'any', label: 'Any activity' },
  { value: 'trade', label: 'Trades / swaps' },
  { value: 'buy', label: 'Buys' },
  { value: 'sell', label: 'Sells' },
  { value: 'receive', label: 'Receives' },
  { value: 'send', label: 'Sends' },
  { value: 'execute', label: 'Contract interactions' },
  { value: 'approval', label: 'Approvals' }
];

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

function formatWalletTimelineDate(timestamp: number | undefined) {
  return timestamp ? new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'N/A';
}

function formatActivityUsd(value: number | undefined) {
  if (!value) return 'No USD quote';
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
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) {
    return `${sign}${absolute.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 8 })}`;
  }
  return `${sign}${absolute.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`;
}

function formatValuationUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  const absolute = Math.abs(value);
  if (absolute > 0 && absolute < 0.01) {
    return absolute.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 8 });
  }
  return absolute.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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
        ? row.proceeds > 0 ? 'Cost basis missing' : 'Open position'
        : remainingQty > Math.max(row.boughtQty * 0.05, 0.000001) ? 'Partial' : 'Closed';

      return {
        token: row.token,
        realizedPnl,
        returnPct,
        valueUsd: realizedPnl === undefined ? row.proceeds || row.cost || undefined : undefined,
        valueLabel: realizedPnl === undefined ? row.proceeds > 0 ? 'Proceeds' : row.cost > 0 ? 'Cost basis' : undefined : 'PnL',
        valuationSource: realizedPnl === undefined ? 'transfer_value' : 'fifo',
        valuationConfidence: realizedPnl === undefined ? 'low' : 'medium',
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
              <Plus size={24} />
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
  const [walletAlertOpen, setWalletAlertOpen] = useState(false);
  const [walletAlertSaving, setWalletAlertSaving] = useState(false);
  const [walletAlertMessage, setWalletAlertMessage] = useState('');
  const [walletAlertError, setWalletAlertError] = useState('');
  const [walletAlertEventTypes, setWalletAlertEventTypes] = useState<WalletAlertEventType[]>(['any']);
  const [walletAlertChannels, setWalletAlertChannels] = useState<string[]>(['in_app']);
  const [walletTelegramConnected, setWalletTelegramConnected] = useState(false);
  const [walletAlertRules, setWalletAlertRules] = useState<SmartAlertRule[]>([]);
  const [walletAlertRulesLoading, setWalletAlertRulesLoading] = useState(false);
  const portfolioState = useWalletPortfolio(validation.isValid ? address : undefined, chain, timeFilter);
  const activityState = useWalletActivity(validation.isValid ? address : undefined, chain, timeFilter, 'all');
  const incompatibleChain = validation.isValid && !isChainCompatible(chain, validation.type);
  const walletTimeline = useMemo(() => {
    const activityTimes = activityState.activity.activities.map((item) => item.timestamp).filter(Boolean);
    const assetTimes = portfolioState.portfolio.assets.map((asset) => asset.buyTime || 0).filter(Boolean);
    const firstSeenAt = [...activityTimes, ...assetTimes].sort((a, b) => a - b)[0];
    const lastActiveAt = activityState.activity.summary.lastActiveAt || activityTimes.sort((a, b) => b - a)[0];

    return {
      firstSeen: formatWalletTimelineDate(firstSeenAt),
      lastActive: formatWalletTimelineDate(lastActiveAt)
    };
  }, [activityState.activity, portfolioState.portfolio.assets]);

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

  useEffect(() => {
    if (!validation.isValid) return;
    let cancelled = false;
    setWalletAlertRulesLoading(true);
    SmartAlertService.listRules()
      .then((rules) => {
        if (cancelled) return;
        const normalizedAddress = address.toLowerCase();
        setWalletAlertRules(rules.filter((rule) => {
          const walletAddress = rule.metadata.wallet?.address?.toLowerCase();
          return rule.alert_type === 'Wallet' && walletAddress === normalizedAddress;
        }));
      })
      .catch(() => {
        if (!cancelled) setWalletAlertRules([]);
      })
      .finally(() => {
        if (!cancelled) setWalletAlertRulesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, validation.isValid]);

  function saveProfile() {
    const next = WalletStorage.save(address, name, categories, chain);
    setSavedWallet(next);
    setEditing(false);
  }

  async function refreshWalletTelegramStatus() {
    try {
      const status = await TelegramService.getStatus();
      setWalletTelegramConnected(status.connected);
      return status.connected;
    } catch {
      setWalletTelegramConnected(false);
      return false;
    }
  }

  function openWalletAlert() {
    setWalletAlertOpen(true);
    void refreshWalletTelegramStatus();
  }

  function toggleWalletAlertEvent(type: WalletAlertEventType) {
    setWalletAlertEventTypes((current) => {
      if (type === 'any') return ['any'];
      const withoutAny = current.filter((item) => item !== 'any');
      const next = withoutAny.includes(type)
        ? withoutAny.filter((item) => item !== type)
        : [...withoutAny, type];
      return next.length ? next : ['any'];
    });
    setWalletAlertError('');
  }

  async function toggleWalletAlertChannel(channel: string) {
    if (channel === 'telegram' && !walletTelegramConnected) {
      const connected = await refreshWalletTelegramStatus();
      if (!connected) {
        setWalletAlertError('Connect Telegram in Settings before using bot alerts.');
        return;
      }
    }

    setWalletAlertChannels((current) => {
      const next = current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel];
      return next.length ? next : ['in_app'];
    });
    setWalletAlertError('');
  }

  async function createWalletAlert() {
    if (!walletAlertEventTypes.length) {
      setWalletAlertError('Choose at least one wallet activity trigger.');
      return;
    }
    if (walletAlertChannels.includes('telegram') && !await refreshWalletTelegramStatus()) {
      setWalletAlertError('Connect Telegram in Settings before using bot alerts.');
      return;
    }

    setWalletAlertSaving(true);
    setWalletAlertError('');
    setWalletAlertMessage('');
    try {
      const rule = await SmartAlertService.createWalletActivityAlert({
        address,
        chain,
        label: savedWallet?.name || name || walletNameFor(address),
        eventTypes: walletAlertEventTypes,
        notificationChannels: walletAlertChannels,
        ignoreSpam: true,
        cooldownMinutes: 0
      });
      setWalletAlertRules((current) => [rule, ...current.filter((item) => item.id !== rule.id)]);
      setWalletAlertOpen(false);
      setWalletAlertMessage('Wallet alert saved. You can manage it from Intelligence Monitor.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setWalletAlertError(/sign in/i.test(message) ? 'Sign in to save wallet alerts.' : message || 'Could not create wallet alert.');
    } finally {
      setWalletAlertSaving(false);
    }
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

      <section className="wallet-detail-grid">
        <div className="wallet-detail-main">
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
                  {walletAlertMessage ? <p className="wallet-alert-note">{walletAlertMessage}</p> : null}
                </>
              )}
              <WalletStatsGrid loading={portfolioState.loading} timelineLoading={activityState.loading} stats={portfolioState.stats} timeline={walletTimeline} />
            </aside>

            <HoldingsTable
              assets={portfolioState.portfolio.assets}
              loading={portfolioState.loading}
              message={portfolioState.portfolio.message}
              timeFilter={timeFilter}
              onRefresh={portfolioState.refreshPortfolio}
            />
          </section>

          <WalletActivityPanel
            timeFilter={timeFilter}
            activity={activityState.activity}
            loading={activityState.loading}
            error={activityState.error}
            refreshActivity={activityState.refreshActivity}
          />
        </div>

        <WalletInsightRail
          walletName={savedWallet?.name || name || walletNameFor(address)}
          categories={categories}
          stats={portfolioState.stats}
          assets={portfolioState.portfolio.assets}
          activity={activityState.activity}
          loadingPortfolio={portfolioState.loading || portfolioState.enriching}
          loadingActivity={activityState.loading}
          alertRules={walletAlertRules}
          loadingAlerts={walletAlertRulesLoading}
          onCreateMonitor={openWalletAlert}
          tradePerformance={portfolioState.portfolio.tradePerformance || []}
          walletPnl={portfolioState.portfolio.pnl}
        />
      </section>
      <WalletAlertModal
        open={walletAlertOpen}
        walletName={savedWallet?.name || name || walletNameFor(address)}
        address={address}
        chain={chain}
        eventTypes={walletAlertEventTypes}
        channels={walletAlertChannels}
        telegramConnected={walletTelegramConnected}
        saving={walletAlertSaving}
        error={walletAlertError}
        onClose={() => {
          setWalletAlertOpen(false);
          setWalletAlertError('');
        }}
        onToggleEvent={toggleWalletAlertEvent}
        onToggleChannel={toggleWalletAlertChannel}
        onSubmit={createWalletAlert}
      />
    </div>
  );
}

function WalletCard({ wallet, onDelete }: { wallet: SavedWallet; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <article className="wallet-card">
      <div className="wallet-card-head">
        <span><Wallet size={16} /></span>
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

function WalletAlertModal({
  open,
  walletName,
  address,
  chain,
  eventTypes,
  channels,
  telegramConnected,
  saving,
  error,
  onClose,
  onToggleEvent,
  onToggleChannel,
  onSubmit
}: {
  open: boolean;
  walletName: string;
  address: string;
  chain: WalletChain;
  eventTypes: WalletAlertEventType[];
  channels: string[];
  telegramConnected: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onToggleEvent: (eventType: WalletAlertEventType) => void;
  onToggleChannel: (channel: string) => void | Promise<void>;
  onSubmit: () => void;
}) {
  if (!open) return null;

  return (
    <div className="wallet-alert-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="wallet-alert-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-alert-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="wallet-alert-modal-head">
          <div>
            <p>Wallet Activity Alert</p>
            <h3 id="wallet-alert-title">{walletName}</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close wallet alert setup">
            <X size={17} />
          </button>
        </div>

        <div className="wallet-alert-summary">
          <span>{shortAddress(address)}</span>
          <span>{chain}</span>
        </div>

        <div className="wallet-alert-section">
          <span className="wallet-alert-label">Trigger</span>
          <div className="wallet-alert-options">
            {WALLET_ALERT_EVENT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={eventTypes.includes(option.value) ? 'selected' : ''}
                onClick={() => onToggleEvent(option.value)}
              >
                {option.label}
                {eventTypes.includes(option.value) ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        </div>

        <div className="wallet-alert-section">
          <span className="wallet-alert-label">Notify</span>
          <div className="wallet-alert-options compact">
            <button type="button" className={channels.includes('in_app') ? 'selected' : ''} onClick={() => onToggleChannel('in_app')}>
              In-app
              {channels.includes('in_app') ? <Check size={14} /> : null}
            </button>
            <button type="button" className={`${channels.includes('telegram') ? 'selected' : ''} ${telegramConnected ? '' : 'muted'}`} onClick={() => void onToggleChannel('telegram')}>
              {telegramConnected ? 'Telegram' : 'Telegram unavailable'}
              {channels.includes('telegram') ? <Check size={14} /> : null}
            </button>
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="wallet-alert-actions">
          <button className="quiet-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-action" type="button" onClick={onSubmit} disabled={saving}>
            {saving ? <Loader2 size={17} className="spin" /> : <Bell size={17} />}
            Create Alert
          </button>
        </div>
      </section>
    </div>
  );
}

function parseSignedMetricValue(value: string | number | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (!value || value === 'N/A') return 0;
  const normalized = value.replace(/[$,%\s]/g, '').replace(/,/g, '');
  return Number(normalized) || 0;
}

function buildWalletInsight(stats: ReturnType<typeof useWalletPortfolio>['stats'], activity: WalletActivity, categories: WalletCategory[], assets: WalletPortfolio['assets']) {
  const trades = activity.activities.filter((item) => item.kind === 'buy' || item.kind === 'sell' || item.kind === 'swap').length;
  const netFlow = activity.summary.netFlowUsd;
  const activePositions = Number(stats.activePositions) || assets.filter((asset) => asset.rawValue > 1).length;
  const pnlValue = parseSignedMetricValue(stats.totalPnl);
  const behaviorType = trades >= 8 ? 'Active Trader' : activePositions >= 4 ? 'Portfolio Builder' : 'Watchlist Wallet';
  const riskProfile = pnlValue < 0 || categories.includes('Sniper') ? 'Moderate' : activePositions >= 6 ? 'Elevated' : 'Low';
  const tradingStyle = trades >= 8 ? 'Short to Mid-Term' : activity.summary.lastActiveAt ? 'Selective Rotation' : 'Holding Bias';
  const preference = categories[0] || (assets.some((asset) => asset.rawValue < 500 && asset.rawValue > 1) ? 'Low Cap' : 'Major Assets');
  const insight = netFlow > 0
    ? 'Recent flow leans positive, with incoming value outweighing outgoing activity.'
    : trades > 0
      ? 'Recent activity shows active wallet movement across tracked positions.'
      : 'Activity is light in this view. Monitor future swaps and transfers for a clearer pattern.';

  return { behaviorType, riskProfile, tradingStyle, preference, insight };
}

function walletMonitorLabel(rule: SmartAlertRule) {
  const events = rule.metadata.eventTypes || [];
  if (!events.length || events.includes('any')) return 'Any wallet activity';
  if (events.includes('trade')) return 'High Value Swaps';
  if (events.includes('receive')) return 'Large Inflows';
  if (events.includes('buy')) return 'Buy Activity';
  if (events.includes('sell')) return 'Sell Activity';
  return rule.trigger_label || 'Wallet Monitor';
}

const WALLET_MONITOR_ROWS = [
  {
    id: 'large-inflows',
    label: 'Large Inflows',
    matches: (rule: SmartAlertRule) => {
      const events = rule.metadata.eventTypes || [];
      return events.includes('receive') || walletMonitorLabel(rule).toLowerCase().includes('inflow');
    }
  },
  {
    id: 'high-value-swaps',
    label: 'High Value Swaps',
    matches: (rule: SmartAlertRule) => {
      const events = rule.metadata.eventTypes || [];
      return events.includes('trade') || events.includes('buy') || events.includes('sell') || walletMonitorLabel(rule).toLowerCase().includes('swap');
    }
  },
  {
    id: 'new-token-interactions',
    label: 'New Token Interactions',
    matches: (rule: SmartAlertRule) => {
      const events = rule.metadata.eventTypes || [];
      return events.includes('approval') || events.includes('execute') || events.includes('any') || walletMonitorLabel(rule).toLowerCase().includes('token');
    }
  }
];

function walletMonitorValue(rules: SmartAlertRule[], loading: boolean) {
  if (loading) return <Loader2 size={14} className="spin" />;
  if (!rules.length) return 'N/A';
  const count = rules.reduce((total, rule) => total + Math.max(1, rule.trigger_count || 0), 0);
  return `${count} ${count === 1 ? 'alert' : 'alerts'}`;
}

function WalletInsightRail({
  walletName,
  categories,
  stats,
  assets,
  activity,
  loadingPortfolio,
  loadingActivity,
  alertRules,
  loadingAlerts,
  onCreateMonitor,
  tradePerformance,
  walletPnl
}: {
  walletName: string;
  categories: WalletCategory[];
  stats: ReturnType<typeof useWalletPortfolio>['stats'];
  assets: WalletPortfolio['assets'];
  activity: WalletActivity;
  loadingPortfolio: boolean;
  loadingActivity: boolean;
  alertRules: SmartAlertRule[];
  loadingAlerts: boolean;
  onCreateMonitor: () => void;
  tradePerformance: WalletTradePerformance[];
  walletPnl?: WalletPnlSummary;
}) {
  const insightLoading = loadingPortfolio || loadingActivity;
  const hasWalletRead = assets.length > 0 || activity.activities.length > 0 || activity.summary.lastActiveAt > 0;
  const insightReady = !insightLoading && hasWalletRead;
  const insight = insightReady ? buildWalletInsight(stats, activity, categories, assets) : null;
  const activeRules = alertRules.filter((rule) => rule.enabled);
  const monitorRows = WALLET_MONITOR_ROWS.map((row) => ({
    ...row,
    rules: activeRules.filter(row.matches)
  }));

  return (
    <aside className="wallet-side-rail">
      <section className="wallet-ai-insights-panel">
        <header>
          <div>
            <h3>Wallet Insight</h3>
            <p>Live read on {walletName}.</p>
          </div>
        </header>
        {insight ? (
          <dl className="wallet-insight-list">
            <div><dt>Behavior Type</dt><dd>{insight.behaviorType}</dd></div>
            <div><dt>Risk Profile</dt><dd className={insight.riskProfile === 'Low' ? 'positive' : 'warning'}>{insight.riskProfile}</dd></div>
            <div><dt>Trading Style</dt><dd>{insight.tradingStyle}</dd></div>
            <div><dt>Preference</dt><dd>{insight.preference}</dd></div>
          </dl>
        ) : (
          <div className="wallet-insight-loading">
            {insightLoading ? <Loader2 size={16} className="spin" /> : null}
            <span>{insightLoading ? 'Reading wallet activity' : 'No wallet insight yet'}</span>
          </div>
        )}
      </section>

      <section className="wallet-monitors-panel">
        <header>
          <h3>Active Monitors</h3>
          <Link to="/smart-alerts">Manage</Link>
        </header>
        <div className="wallet-monitor-list">
          {monitorRows.map((row) => (
            <div key={row.id} className="wallet-monitor-row">
              <strong>{row.label}</strong>
              <em>{walletMonitorValue(row.rules, loadingAlerts)}</em>
            </div>
          ))}
        </div>
        <button className="quiet-button wallet-monitor-create" type="button" onClick={onCreateMonitor}>
          <Plus size={17} />
          Create New Monitor
        </button>
      </section>

      <TradePerformancePanel activity={activity} tradePerformance={tradePerformance} walletPnl={walletPnl} assets={assets} />
    </aside>
  );
}

function WalletStatsGrid({
  stats,
  loading,
  timeline,
  timelineLoading
}: {
  stats: ReturnType<typeof useWalletPortfolio>['stats'];
  loading: boolean;
  timeline: { firstSeen: string; lastActive: string };
  timelineLoading: boolean;
}) {
  const pnlLabels = new Set(['Total PnL', 'Realized PnL', 'Unrealized PnL']);
  const metricTone = (label: string, value: string | number) => {
    if (!pnlLabels.has(label)) return '';
    const signedValue = parseSignedMetricValue(value);
    if (signedValue > 0) return 'positive';
    if (signedValue < 0) return 'negative';
    return '';
  };
  const items = [
    { label: 'Net Worth', value: stats.netWorth },
    { label: 'Win Rate', value: stats.winRate },
    { label: 'Total PnL', value: stats.totalPnl },
    { label: 'Realized PnL', value: stats.realizedPnl },
    { label: 'Unrealized PnL', value: stats.unrealizedPnl },
    { label: 'Active Positions', value: stats.activePositions },
    { label: 'Profitable Positions', value: stats.profitablePositions },
    { label: 'Avg Hold Time', value: stats.avgHoldTime }
  ];
  const timelineItems = [
    { label: 'First Seen', value: timeline.firstSeen },
    { label: 'Last Activity', value: timeline.lastActive, active: timeline.lastActive !== 'N/A' }
  ];

  return (
    <section className="wallet-stats-grid">
      {items.map(({ label, value }) => (
        <div key={label}>
          <span>{label}</span>
          <strong className={loading ? '' : metricTone(label, value)}>{loading ? <Loader2 size={18} className="spin" /> : value}</strong>
        </div>
      ))}
      {timelineItems.map(({ label, value, active }) => (
        <div key={label}>
          <span>{label}</span>
          <strong className="wallet-timeline-value">
            {timelineLoading ? <Loader2 size={18} className="spin" /> : (
              <>
                {value}
                {active ? <i aria-hidden="true" /> : null}
              </>
            )}
          </strong>
        </div>
      ))}
    </section>
  );
}

function hasReportedTokenBalance(asset: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number]) {
  return typeof asset.rawBalance === 'number' ? asset.rawBalance > 0 : asset.rawValue > 0;
}

function shouldShowHolding(asset: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number], showSmallBalances: boolean) {
  if (!hasReportedTokenBalance(asset)) return false;
  if (asset.rawValue <= 0 || asset.currentPrice <= 0) return false;
  if (showSmallBalances) return true;
  return asset.rawValue >= 1;
}

function holdingStatusLabel(status: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number]['performanceStatus']) {
  if (status === 'reported') return 'Reported by Zerion';
  if (status === 'cost_basis_missing') return 'Cost basis missing';
  if (status === 'unpriced_transfer') return 'No priced basis';
  if (status === 'no_price_quote') return 'No USD quote';
  return 'Unavailable';
}

function holdingTimeStatusLabel(status: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number]['timeHeldStatus']) {
  if (status === 'reported') return 'Reported by Zerion';
  return 'Unknown';
}

function holdingTone(asset: ReturnType<typeof useWalletPortfolio>['portfolio']['assets'][number]) {
  if (asset.pnlPercent && asset.pnlPercent > 0) return 'positive';
  if (asset.pnlPercent && asset.pnlPercent < 0) return 'negative';
  if (asset.pnl?.startsWith('+')) return 'positive';
  if (asset.pnl?.startsWith('-')) return 'negative';
  return '';
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
    .filter((asset) => shouldShowHolding(asset, showSmallBalances))
    .sort((a, b) => (b.rawValue - a.rawValue) || ((b.rawBalance || 0) - (a.rawBalance || 0)) || a.symbol.localeCompare(b.symbol)), [assets, showSmallBalances]);

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
                <th>Price</th>
                <th>Value</th>
                <th>{timeFilter === 'ALL' ? 'Unrealized PnL' : `${timeFilter} Unrealized PnL`}</th>
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
                  <td>{asset.price}</td>
                  <td>{asset.value}</td>
                  <td className={holdingTone(asset)}>
                    <span className="holding-metric">
                      <strong>
                        {asset.pnl || holdingStatusLabel(asset.performanceStatus)}
                        {asset.pnl && asset.pnlPercent !== undefined ? <span className="holding-return"> ({formatPerformanceReturn(asset.pnlPercent)})</span> : null}
                      </strong>
                      {asset.pnl && asset.performanceStatus === 'cost_basis_missing' ? <small>{holdingStatusLabel(asset.performanceStatus)}</small> : null}
                    </span>
                  </td>
                  <td>
                    <span className="holding-metric">
                      <strong>{asset.buyTime ? formatTimeHeld(asset.buyTime) : holdingTimeStatusLabel(asset.timeHeldStatus)}</strong>
                    </span>
                  </td>
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

function WalletActivityPanel({
  timeFilter,
  activity,
  loading,
  error,
  refreshActivity
}: {
  timeFilter: WalletTimeFilter;
  activity: WalletActivity;
  loading: boolean;
  error: string | null;
  refreshActivity: () => void;
}) {
  const rows = activity.activities;

  return (
    <section className="wallet-activity-shell">
      <section className="wallet-activity-panel">
        <div className="wallet-activity-head">
          <div>
            <h3>Wallet Activity</h3>
          </div>
          <button className="icon-button" type="button" onClick={refreshActivity} aria-label="Refresh wallet activity">
            {loading ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

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
      </section>
    </section>
  );
}

function tradeRowKey(row: WalletTradePerformance) {
  return (row.token.address || row.id || row.token.symbol).toLowerCase();
}

function hasPerformanceValue(row: WalletTradePerformance) {
  return row.realizedPnl !== undefined || row.unrealizedPnl !== undefined || row.totalPnl !== undefined || row.returnPct !== undefined;
}

function hasValuationValue(row: WalletTradePerformance) {
  return hasPerformanceValue(row) || row.valueUsd !== undefined;
}

function tradeRowSortScore(row: WalletTradePerformance) {
  if (hasPerformanceValue(row)) return 0;
  if (row.valueUsd !== undefined) return 1;
  return 2;
}

function mergeTradePerformanceRows(rows: WalletTradePerformance[]) {
  const merged = new Map<string, WalletTradePerformance>();
  rows.forEach((row) => {
    const key = tradeRowKey(row);
    const existing = merged.get(key);
    if (!existing || (!hasValuationValue(existing) && hasValuationValue(row)) || (!hasPerformanceValue(existing) && hasPerformanceValue(row))) {
      merged.set(key, row);
    }
  });
  return Array.from(merged.values()).sort((left, right) => (
    tradeRowSortScore(left) - tradeRowSortScore(right)
    || Math.abs(right.totalPnl ?? right.realizedPnl ?? right.valueUsd ?? 0) - Math.abs(left.totalPnl ?? left.realizedPnl ?? left.valueUsd ?? 0)
    || left.token.symbol.localeCompare(right.token.symbol)
  ));
}

function positionPerformanceRows(assets: WalletPortfolio['assets']): WalletTradePerformance[] {
  return assets
    .filter((asset) => !asset.isStablecoin)
    .filter((asset) => asset.totalPnl !== undefined || asset.totalReturnPct !== undefined || asset.realizedPnl !== undefined || asset.unrealizedPnl !== undefined || asset.performanceStatus === 'cost_basis_missing' || asset.performanceStatus === 'unpriced_transfer' || asset.performanceStatus === 'no_price_quote')
    .map((asset): WalletTradePerformance => {
      const totalPnl = asset.totalPnl ?? (asset.realizedPnl !== undefined || asset.unrealizedPnl !== undefined
        ? (asset.realizedPnl || 0) + (asset.unrealizedPnl || 0)
        : undefined);
      const status: WalletTradePerformance['status'] = asset.performanceStatus === 'no_price_quote'
        ? 'No USD quote'
        : asset.performanceStatus === 'unpriced_transfer'
          ? 'No priced basis'
          : asset.performanceStatus === 'cost_basis_missing'
            ? 'Cost basis missing'
            : asset.rawBalance && asset.rawBalance > 0 ? asset.realizedPnl !== undefined ? 'Partial' : 'Open position' : 'Closed';

      return {
        id: asset.address || asset.symbol,
        token: {
          address: asset.address,
          symbol: asset.symbol,
          logo: asset.logo
        },
        realizedPnl: asset.realizedPnl,
        unrealizedPnl: asset.unrealizedPnl,
        totalPnl,
        returnPct: asset.totalReturnPct,
        invested: asset.costBasisUsd,
        openCostBasis: asset.openCostBasisUsd,
        valueUsd: totalPnl === undefined ? asset.rawValue || asset.openCostBasisUsd || asset.costBasisUsd || asset.proceedsUsd : undefined,
        valueLabel: totalPnl === undefined ? asset.rawValue > 0 ? 'Value' : asset.openCostBasisUsd || asset.costBasisUsd ? 'Cost basis' : asset.proceedsUsd ? 'Proceeds' : undefined : 'PnL',
        valuationSource: totalPnl === undefined ? asset.rawValue > 0 ? 'current_value' : asset.pnlSource === 'historical_price' ? 'historical_price' : asset.openCostBasisUsd || asset.costBasisUsd || asset.proceedsUsd ? 'transfer_value' : undefined : asset.pnlSource === 'zerion' ? 'zerion' : asset.pnlSource === 'historical_price' ? 'historical_price' : 'fifo',
        valuationConfidence: totalPnl === undefined ? asset.rawValue > 0 ? 'medium' : asset.pnlConfidence : asset.pnlConfidence,
        status
      };
    });
}

function TradePerformancePanel({ activity, tradePerformance, walletPnl, assets }: { activity: WalletActivity; tradePerformance: WalletTradePerformance[]; walletPnl?: WalletPnlSummary; assets: WalletPortfolio['assets'] }) {
  const activityRows = buildTradePerformanceRows(activity);
  const derivedRows: WalletTradePerformance[] = activityRows.map((row) => ({
    id: `${row.token.address || row.token.symbol}:${row.status}`,
    token: row.token,
    realizedPnl: row.realizedPnl,
    totalPnl: row.realizedPnl,
    returnPct: row.returnPct,
    valueUsd: row.valueUsd,
    valueLabel: row.valueLabel as WalletTradePerformance['valueLabel'],
    valuationSource: row.valuationSource as WalletTradePerformance['valuationSource'],
    valuationConfidence: row.valuationConfidence as WalletTradePerformance['valuationConfidence'],
    status: row.status as WalletTradePerformance['status']
  }));
  const rows = mergeTradePerformanceRows([
    ...tradePerformance,
    ...positionPerformanceRows(assets),
    ...derivedRows
  ]);

  return (
    <aside className="wallet-performance-panel">
      <header>
        <h4>Trade History</h4>
        <span>{rows.length}</span>
      </header>
      {rows.length ? rows.map((row) => (
        <div className="wallet-performance-row" key={`${row.token.address || row.token.symbol}:${row.status}:${row.realizedPnl || row.totalPnl || ''}`}>
          <div className="wallet-performance-main">
            <span className="wallet-performance-token">
              {row.token.logo ? <img src={row.token.logo} alt="" /> : <i>{row.token.symbol.slice(0, 1)}</i>}
              <strong>{row.token.symbol}</strong>
            </span>
            <span className={`wallet-performance-status ${row.status.toLowerCase().replace(/\s+/g, '-')}`}>{row.status}</span>
          </div>
          {row.realizedPnl !== undefined || row.totalPnl !== undefined ? (
            <small className="wallet-performance-metric">
              <>
                <span className="wallet-performance-metric-line">
                  <span className={(row.totalPnl ?? row.realizedPnl ?? 0) > 0 ? 'positive' : (row.totalPnl ?? row.realizedPnl ?? 0) < 0 ? 'negative' : ''}>{formatPerformanceUsd(row.totalPnl ?? row.realizedPnl)}</span>
                  {row.returnPct !== undefined ? (
                    <span className={row.returnPct > 0 ? 'positive' : row.returnPct < 0 ? 'negative' : ''}>({formatPerformanceReturn(row.returnPct)})</span>
                  ) : null}
                </span>
                {row.realizedPnl !== undefined && row.unrealizedPnl !== undefined ? (
                  <span className="wallet-performance-breakdown">Realized {formatPerformanceUsd(row.realizedPnl)} / Open {formatPerformanceUsd(row.unrealizedPnl)}</span>
                ) : null}
              </>
            </small>
          ) : row.valueUsd !== undefined ? (
            <small className="wallet-performance-metric">
              <span className="wallet-performance-metric-line">
                <span>{formatValuationUsd(row.valueUsd)}</span>
              </span>
              <span className="wallet-performance-breakdown">
                {row.valueLabel || 'Value'}{row.valuationSource ? ` (${row.valuationSource.replace(/_/g, ' ')})` : ''}
              </span>
            </small>
          ) : null}
        </div>
      )) : (
        <div className="wallet-performance-empty">
          {walletPnl ? (
            <>
              <p>Zerion returned wallet-level PnL only for this filter.</p>
              <small>
                <span>Total {formatPerformanceUsd(walletPnl.totalGain)}</span>
                <span>Realized {formatPerformanceUsd(walletPnl.realizedGain)}</span>
                <span>Unrealized {formatPerformanceUsd(walletPnl.unrealizedGain)}</span>
              </small>
            </>
          ) : (
            <p>No completed trade data yet.</p>
          )}
        </div>
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

  if (!item.tokens.length) return <span className="wallet-activity-token-flow muted">No token movement</span>;

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
      <span className="wallet-asset-text">
        <strong>{asset.symbol}</strong>
        <small>{asset.chain || 'Unknown'}</small>
      </span>
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
