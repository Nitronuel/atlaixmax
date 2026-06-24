import {
  Bell,
  Bot,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CoinGeckoCoin } from '../../shared/coingecko';
import { useAuth } from '../../contexts/AuthContext';
import { formatPercentValue, formatPrice, formatUsd } from '../overview/overview-utils';
import { WatchlistService } from './watchlist-service';
import type {
  WatchlistActivityItem,
  WatchlistAsset,
  WatchlistAssetInput,
  WatchlistAssetType,
  WatchlistMonitorSettings,
  WatchlistSummary
} from './watchlist-types';

const ASSISTANT_HANDOFF_KEY = 'atlaix-ai-assistant-handoff-v1';
const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const MONITOR_LABELS: Array<{ key: keyof WatchlistMonitorSettings; label: string; detail: string }> = [
  { key: 'detectionEvents', label: 'Detection Events', detail: 'Market structure and event changes' },
  { key: 'riskChanges', label: 'Risk Changes', detail: 'High-risk state movement' },
  { key: 'aiStateChanges', label: 'AI State Changes', detail: 'Accumulation, recovery, stress, or weakness' },
  { key: 'majorVolumeEvents', label: 'Major Volume Events', detail: 'Large volume expansion or compression' }
];

const EMPTY_SUMMARY: WatchlistSummary = {
  generatedAt: new Date().toISOString(),
  metrics: [
    { label: 'Assets Tracked', value: 0, note: '0 tokens, 0 coins' },
    { label: 'New Events', value: 0, note: 'Last 24h' },
    { label: 'Risk Changes', value: 0, note: 'Matched alerts and events' },
    { label: 'Active Monitors', value: 0, note: 'Assets with monitors on' },
    { label: 'Last 24h Changes', value: 0, note: 'Watchlist activity' }
  ],
  summary: 'Add tokens or coins to start monitoring market events, risk changes, liquidity movement, and state shifts from one workspace.',
  activity: []
};

function relativeTime(value: string | null | undefined) {
  if (!value) return 'Never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Never';
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'Just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function assetHref(asset: WatchlistAsset) {
  if (asset.assetType === 'coin' && asset.coinId) return `/coin/${encodeURIComponent(asset.coinId)}`;
  if (!asset.tokenAddress || !asset.chainId) return '#';
  const params = new URLSearchParams({ chain: asset.chainId });
  if (asset.pairAddress) params.set('pair', asset.pairAddress);
  return `/token/${encodeURIComponent(asset.tokenAddress)}?${params.toString()}`;
}

function shortAddress(value: string | null) {
  if (!value) return '';
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value;
}

function isLikelyTokenAddress(value: string) {
  const trimmed = value.trim();
  return evmAddressPattern.test(trimmed) || solanaAddressPattern.test(trimmed);
}

function assetInitials(symbol: string, name = '') {
  return (symbol || name || '?').slice(0, 2).toUpperCase();
}

function ActivityAssetLogo({ item, asset }: { item: WatchlistActivityItem; asset?: WatchlistAsset | null }) {
  const imageUrl = asset?.imageUrl;
  return (
    <span className="watchlist-activity-logo" aria-hidden="true">
      {imageUrl ? <img src={imageUrl} alt="" /> : assetInitials(item.assetSymbol || asset?.symbol || '', item.assetName || asset?.name || '')}
    </span>
  );
}

export function WatchlistPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [assets, setAssets] = useState<WatchlistAsset[]>([]);
  const [summary, setSummary] = useState<WatchlistSummary>(EMPTY_SUMMARY);
  const [activity, setActivity] = useState<WatchlistActivityItem[]>([]);
  const [activeTab, setActiveTab] = useState<WatchlistAssetType>('token');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<WatchlistAsset | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  async function loadWatchlist() {
    if (!user) {
      setAssets([]);
      setSummary(EMPTY_SUMMARY);
      setActivity([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [nextAssets, nextSummary, nextActivity] = await Promise.all([
        WatchlistService.listAssets(),
        WatchlistService.getSummary(),
        WatchlistService.getActivity(30)
      ]);
      setAssets(nextAssets);
      setSummary(nextSummary);
      setActivity(nextActivity);
      if (selectedAsset) {
        setSelectedAsset(nextAssets.find((asset) => asset.id === selectedAsset.id) || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watchlist could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWatchlist();
  }, [user?.id]);

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter((asset) => {
      if (asset.assetType !== activeTab) return false;
      if (!normalized) return true;
      return `${asset.symbol} ${asset.name} ${asset.tokenAddress || ''} ${asset.coinId || ''}`.toLowerCase().includes(normalized);
    });
  }, [activeTab, assets, query]);

  const selectedActivity = useMemo(() => (
    selectedAsset ? activity.filter((item) => item.assetId === selectedAsset.id).slice(0, 5) : []
  ), [activity, selectedAsset]);

  const alertSummaryByAsset = useMemo(() => {
    const summaries = new Map<string, { count: number; hasRisk: boolean }>();
    activity.forEach((item) => {
      if (!item.assetId) return;
      const current = summaries.get(item.assetId) || { count: 0, hasRisk: false };
      summaries.set(item.assetId, {
        count: current.count + 1,
        hasRisk: current.hasRisk || item.tone === 'risk'
      });
    });
    return summaries;
  }, [activity]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const askAi = () => {
    const assetLines = assets.slice(0, 12).map((asset) => `${asset.symbol || asset.name}: ${asset.state || asset.lastEventType || 'No current event'}`).join('\n');
    const draft = `Summarize my watchlist. Focus on assets with new events, risk changes, improving states, and deteriorating states.\n\nCurrent watchlist:\n${assetLines || 'No assets added yet.'}`;
    window.sessionStorage.setItem(ASSISTANT_HANDOFF_KEY, JSON.stringify({
      draft,
      pageContext: {
        route: '/watchlist',
        module: 'watchlist',
        title: 'Watchlist',
        systemContext: 'The user is reviewing the Atlaix Watchlist Intelligence workspace. Focus on monitored assets, recent changes, risk movement, detection events, and useful next actions.',
        subjectKind: 'dashboard',
        preferredTools: ['overview', 'detection', 'smart-alerts', 'safe-scan'],
        visibleSnapshot: {
          generatedAt: Date.now(),
          summary: summary.summary,
          tokens: assets.slice(0, 20).map((asset) => ({
            symbol: asset.symbol,
            name: asset.name,
            type: asset.assetType,
            state: asset.state,
            risk: asset.riskLevel,
            lastEvent: asset.lastEventType
          }))
        }
      },
      savedAt: Date.now()
    }));
    navigate('/ai-assistant?handoff=1');
  };

  const removeAsset = async (asset: WatchlistAsset) => {
    await WatchlistService.deleteAsset(asset.id);
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    if (selectedAsset?.id === asset.id) setSelectedAsset(null);
    void loadWatchlist();
  };

  const toggleMonitor = async (asset: WatchlistAsset, key: keyof WatchlistMonitorSettings) => {
    const monitorSettings = {
      ...asset.monitorSettings,
      [key]: !asset.monitorSettings[key]
    };
    const updated = await WatchlistService.updateAsset(asset.id, { monitorSettings });
    setAssets((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSelectedAsset((current) => current?.id === updated.id ? updated : current);
  };

  if (authLoading || loading) {
    return (
      <div className="watchlist-page watchlist-loading">
        <Loader2 size={28} className="watchlist-spin" />
        <strong>Loading watchlist intelligence</strong>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="watchlist-page">
        <section className="watchlist-auth-panel">
          <Sparkles size={28} />
          <h2>Sign in to build your watchlist</h2>
          <p>Your Watchlist workspace saves assets, monitor settings, recent changes, and AI context to your account.</p>
          <button type="button" onClick={() => navigate('/login')}>Sign in</button>
        </section>
      </div>
    );
  }

  return (
    <div className="watchlist-page">
      <section className="watchlist-toolbar">
        <div>
          <h2>Watchlist</h2>
          <p>Monitor tracked tokens and coins from one intelligence workspace.</p>
        </div>
        <div className="watchlist-toolbar-actions">
          <label className="watchlist-search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tokens or coins" />
          </label>
          <button className="watchlist-primary-button" type="button" onClick={() => setAddOpen(true)}>
            <Plus size={18} />
            Add to Watchlist
          </button>
          <button className="watchlist-icon-button" type="button" onClick={loadWatchlist} aria-label="Refresh watchlist">
            <RefreshCw size={18} />
          </button>
        </div>
      </section>

      {error ? <div className="watchlist-error">{error}</div> : null}

      <section className="watchlist-grid">
        <div className="watchlist-main">
          <section className="watchlist-ai-summary">
            <div>
              <div className="watchlist-ai-summary-head">
                <div>
                  <small>Watchlist read</small>
                  <h3>AI Summary</h3>
                </div>
              </div>
              <p>{summary.summary}</p>
            </div>
            <button type="button" onClick={askAi}>
              <Bot size={17} />
              Ask AI
            </button>
          </section>

          <section className="watchlist-metrics">
            {summary.metrics.map((metric) => (
              <article key={metric.label}>
                <small>{metric.label}</small>
                <strong>{metric.value}</strong>
                <span>{metric.note}</span>
              </article>
            ))}
          </section>

          <section className="watchlist-table-panel">
            <div className="watchlist-table-head">
              <div className="watchlist-tabs" role="tablist" aria-label="Watchlist asset type">
                <button className={activeTab === 'token' ? 'active' : ''} type="button" onClick={() => setActiveTab('token')}>Tokens</button>
                <button className={activeTab === 'coin' ? 'active' : ''} type="button" onClick={() => setActiveTab('coin')}>Coins</button>
              </div>
              <button className="watchlist-secondary-button" type="button" onClick={() => setAddOpen(true)}>
                <Plus size={16} />
                Add {activeTab === 'token' ? 'Token' : 'Coin'}
              </button>
            </div>

            {visibleAssets.length ? (
              <div className="watchlist-table-wrap">
                <table className="watchlist-table">
                  <thead>
                    <tr>
                      <th>Asset</th>
                      <th>Type</th>
                      <th>Price</th>
                      <th>24h</th>
                      <th>Last Event</th>
                      <th>Risk</th>
                      <th>Alerts</th>
                      <th>Added</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAssets.map((asset) => (
                      <tr key={asset.id} onClick={() => setSelectedAsset(asset)}>
                        <td>
                          <div className="watchlist-asset-cell">
                            <span className="watchlist-asset-logo">{asset.imageUrl ? <img src={asset.imageUrl} alt="" /> : asset.symbol.slice(0, 2)}</span>
                            <span>
                              <strong>{asset.name || asset.symbol}</strong>
                              <small>{asset.symbol}{asset.tokenAddress ? ` - ${shortAddress(asset.tokenAddress)}` : ''}</small>
                            </span>
                          </div>
                        </td>
                        <td><span className={`watchlist-type-pill ${asset.assetType}`}>{asset.assetType}</span></td>
                        <td>{formatPrice(asset.priceUsd)}</td>
                        <td className={Number(asset.priceChange24h || 0) >= 0 ? 'watchlist-positive' : 'watchlist-negative'}>{formatPercentValue(asset.priceChange24h)}</td>
                        <td>{asset.lastEventType || 'No recent event'}<small>{relativeTime(asset.lastEventAt)}</small></td>
                        <td><span className={`watchlist-risk-pill ${String(asset.riskLevel || 'unknown').toLowerCase()}`}>{asset.riskLevel || 'Not scanned'}</span></td>
                        <td>
                          <span
                            className={`watchlist-alert-indicator ${alertSummaryByAsset.get(asset.id)?.count ? 'has-alerts' : 'is-idle'} ${alertSummaryByAsset.get(asset.id)?.hasRisk ? 'is-risk' : ''}`}
                            title={`${alertSummaryByAsset.get(asset.id)?.count || 0} watchlist alerts`}
                          >
                            <Bell size={14} />
                            <strong>{alertSummaryByAsset.get(asset.id)?.count || 0}</strong>
                          </span>
                        </td>
                        <td>{relativeTime(asset.createdAt)}</td>
                        <td>
                          <button className="watchlist-row-action" type="button" onClick={(event) => { event.stopPropagation(); setSelectedAsset(asset); }} aria-label={`Open ${asset.symbol} watchlist details`}>
                            <ExternalLink size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="watchlist-empty">
                <Sparkles size={24} />
                <h3>No {activeTab === 'token' ? 'tokens' : 'coins'} in your watchlist yet</h3>
                <p>Add assets you care about and Atlaix will track events, monitor changes, and keep the AI context ready.</p>
                <button type="button" onClick={() => setAddOpen(true)}>Add {activeTab === 'token' ? 'Token' : 'Coin'}</button>
              </div>
            )}
          </section>
        </div>

        <aside className="watchlist-side">
          <section>
            <div className="watchlist-side-head">
              <h3>Recent Activities</h3>
              <button type="button" onClick={loadWatchlist}>Refresh</button>
            </div>
            <div className="watchlist-activity-list">
              {activity.length ? activity.slice(0, 8).map((item) => (
                <button type="button" key={item.id} className={`watchlist-activity-item ${item.tone}`} onClick={() => item.href ? navigate(item.href) : undefined}>
                  <ActivityAssetLogo item={item} asset={item.assetId ? assetById.get(item.assetId) : null} />
                  <strong>{item.title}<small>{item.assetSymbol || item.assetName}</small></strong>
                  <em>{relativeTime(item.createdAt)}</em>
                </button>
              )) : (
                <p className="watchlist-muted">No recent watchlist changes yet.</p>
              )}
            </div>
          </section>

          <section>
            <h3>Quick Actions</h3>
            <div className="watchlist-quick-actions token-quick-actions-panel">
              <button className="token-quick-action-button" type="button" onClick={() => { setActiveTab('token'); setAddOpen(true); }}>
                <span className="token-quick-action-icon"><Plus size={18} /></span>
                <span><strong>Add Token</strong><small>Track contract</small></span>
              </button>
              <button className="token-quick-action-button" type="button" onClick={() => navigate('/smart-alerts')}>
                <span className="token-quick-action-icon"><Bell size={18} /></span>
                <span><strong>Create Monitor</strong><small>Smart alerts</small></span>
              </button>
              <button className="token-quick-action-button" type="button" onClick={() => navigate('/safe-scan')}>
                <span className="token-quick-action-icon"><ShieldCheck size={18} /></span>
                <span><strong>Run SafeScan</strong><small>Risk scan</small></span>
              </button>
            </div>
          </section>
        </aside>
      </section>

      {selectedAsset ? (
        <AssetDrawer
          asset={selectedAsset}
          activity={selectedActivity}
          onClose={() => setSelectedAsset(null)}
          onOpen={() => navigate(assetHref(selectedAsset))}
          onRemove={() => void removeAsset(selectedAsset)}
          onRefresh={async () => {
            const refreshed = await WatchlistService.refreshAsset(selectedAsset.id);
            setAssets((current) => current.map((item) => item.id === refreshed.id ? refreshed : item));
            setSelectedAsset(refreshed);
          }}
          onToggleMonitor={(key) => void toggleMonitor(selectedAsset, key)}
        />
      ) : null}

      {addOpen ? (
        <AddAssetDialog
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onClose={() => setAddOpen(false)}
          onAdded={(asset) => {
            setAssets((current) => current.some((item) => item.id === asset.id) ? current : [asset, ...current]);
            setAddOpen(false);
            void loadWatchlist();
          }}
        />
      ) : null}
    </div>
  );
}

function AssetDrawer({ asset, activity, onClose, onOpen, onRemove, onRefresh, onToggleMonitor }: {
  asset: WatchlistAsset;
  activity: WatchlistActivityItem[];
  onClose: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onRefresh: () => void;
  onToggleMonitor: (key: keyof WatchlistMonitorSettings) => void;
}) {
  return (
    <div className="watchlist-drawer-shell" role="dialog" aria-modal="true" aria-label={`${asset.symbol} intelligence`}>
      <button className="watchlist-drawer-scrim" type="button" onClick={onClose} aria-label="Close asset drawer" />
      <aside className="watchlist-drawer">
        <div className="watchlist-drawer-head">
          <div className="watchlist-asset-cell">
            <span className="watchlist-asset-logo large">{asset.imageUrl ? <img src={asset.imageUrl} alt="" /> : asset.symbol.slice(0, 2)}</span>
            <span>
              <strong>{asset.name || asset.symbol}</strong>
              <small>{asset.symbol} - {asset.assetType}</small>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close asset drawer"><X size={19} /></button>
        </div>

        <div className="watchlist-drawer-stats">
          <div><small>Last Event</small><strong>{asset.lastEventType || 'No recent event'}</strong></div>
          <div><small>Risk</small><strong>{asset.riskLevel || 'Not scanned'}</strong></div>
          <div><small>Alerts</small><strong>{activity.length}</strong></div>
        </div>

        <section>
          <h3>Recent Activities</h3>
          {activity.length ? activity.map((item) => (
            <article className={`watchlist-drawer-event ${item.tone}`} key={item.id}>
              <ActivityAssetLogo item={item} asset={asset} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <small>{relativeTime(item.createdAt)}</small>
              </div>
            </article>
          )) : <p className="watchlist-muted">No matched events for this asset yet.</p>}
        </section>

        <section>
          <h3>Intelligence Monitors</h3>
          <div className="watchlist-monitor-list">
            {MONITOR_LABELS.map((item) => (
              <label key={item.key}>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <input type="checkbox" checked={asset.monitorSettings[item.key]} onChange={() => onToggleMonitor(item.key)} />
              </label>
            ))}
          </div>
        </section>

        <div className="watchlist-drawer-actions">
          <button type="button" onClick={onOpen}><ExternalLink size={17} /> Open Asset</button>
          <button type="button" onClick={onRefresh}><RefreshCw size={17} /> Refresh</button>
          <button className="danger" type="button" onClick={onRemove}><Trash2 size={17} /> Remove</button>
        </div>
      </aside>
    </div>
  );
}

function AddAssetDialog({ activeTab, setActiveTab, onClose, onAdded }: {
  activeTab: WatchlistAssetType;
  setActiveTab: (value: WatchlistAssetType) => void;
  onClose: () => void;
  onAdded: (asset: WatchlistAsset) => void;
}) {
  const [chainId, setChainId] = useState('ethereum');
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [coinQuery, setCoinQuery] = useState('');
  const [coinResults, setCoinResults] = useState<CoinGeckoCoin[]>([]);
  const [pending, setPending] = useState(false);
  const [tokenLookupLoading, setTokenLookupLoading] = useState(false);
  const [tokenLookupStatus, setTokenLookupStatus] = useState('');
  const [lastAutoToken, setLastAutoToken] = useState({ symbol: '', name: '' });
  const [error, setError] = useState('');
  const lookupRequestRef = useRef(0);

  useEffect(() => {
    if (activeTab !== 'coin' || coinQuery.trim().length < 2) {
      setCoinResults([]);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      WatchlistService.searchCoins(coinQuery)
        .then((coins) => setCoinResults(coins.slice(0, 8)))
        .catch(() => setCoinResults([]));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [activeTab, coinQuery]);

  useEffect(() => {
    if (activeTab !== 'token') return undefined;

    const address = tokenAddress.trim();
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;

    if (!address) {
      setTokenLookupLoading(false);
      setTokenLookupStatus('');
      setLastAutoToken({ symbol: '', name: '' });
      return undefined;
    }

    if (!isLikelyTokenAddress(address)) {
      setTokenLookupLoading(false);
      setTokenLookupStatus(address.length > 10 ? 'Enter a full contract address to identify the token.' : '');
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setTokenLookupLoading(true);
      setTokenLookupStatus('Finding token details...');

      try {
        const { token } = await WatchlistService.lookupToken(address, '');
        if (lookupRequestRef.current !== requestId) return;

        const nextSymbol = token.symbol || '';
        const nextName = token.name || '';
        setTokenSymbol((current) => (
          !current.trim() || current === lastAutoToken.symbol ? nextSymbol || current : current
        ));
        setTokenName((current) => (
          !current.trim() || current === lastAutoToken.name ? nextName || current : current
        ));
        if (token.chainId) setChainId(token.chainId);
        setTokenAddress(token.address || address);
        setLastAutoToken({ symbol: nextSymbol, name: nextName });
        setTokenLookupStatus(nextSymbol || nextName ? `Found ${nextSymbol || nextName}.` : 'Token found.');
      } catch {
        if (lookupRequestRef.current !== requestId) return;
        setTokenLookupStatus('Could not identify that token yet. You can still enter details manually.');
      } finally {
        if (lookupRequestRef.current === requestId) setTokenLookupLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [activeTab, tokenAddress]);

  async function addToken() {
    const address = tokenAddress.trim();
    if (!address) {
      setError('Token address is required.');
      return;
    }

    setPending(true);
    setError('');
    try {
      let input: WatchlistAssetInput = {
        assetType: 'token',
        chainId,
        tokenAddress: address,
        symbol: tokenSymbol || address.slice(0, 6),
        name: tokenName || tokenSymbol || address,
        monitorSettings: WatchlistService.defaultMonitors
      };
      try {
        const { token } = await WatchlistService.lookupToken(address, chainId);
        input = {
          ...input,
          chainId: token.chainId || chainId,
          tokenAddress: token.address || address,
          pairAddress: token.pairAddress,
          symbol: token.symbol || input.symbol,
          name: token.name || input.name,
          imageUrl: token.imageUrl || null,
          priceUsd: token.priceUsd,
          priceChange24h: token.change24h,
          liquidityUsd: token.liquidityUsd,
          riskLevel: token.riskLevel
        };
      } catch {
        // Manual token save still works if lookup misses.
      }
      onAdded(await WatchlistService.createAsset(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Token could not be added.');
    } finally {
      setPending(false);
    }
  }

  async function addCoin(coin: CoinGeckoCoin) {
    setPending(true);
    setError('');
    try {
      onAdded(await WatchlistService.createAsset({
        assetType: 'coin',
        coinId: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        imageUrl: coin.image || null,
        priceUsd: coin.priceUsd,
        priceChange24h: coin.change24h,
        monitorSettings: WatchlistService.defaultMonitors,
        state: coin.event
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Coin could not be added.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="watchlist-dialog-shell" role="dialog" aria-modal="true" aria-label="Add to Watchlist">
      <button className="watchlist-drawer-scrim" type="button" onClick={onClose} aria-label="Close add dialog" />
      <section className="watchlist-dialog">
        <div className="watchlist-dialog-head">
          <div>
            <h3>Add to Watchlist</h3>
            <p>Track a token contract or a market coin.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close add dialog"><X size={19} /></button>
        </div>

        <div className="watchlist-tabs compact">
          <button className={activeTab === 'token' ? 'active' : ''} type="button" onClick={() => setActiveTab('token')}>Token</button>
          <button className={activeTab === 'coin' ? 'active' : ''} type="button" onClick={() => setActiveTab('coin')}>Coin</button>
        </div>

        {activeTab === 'token' ? (
          <div className="watchlist-form">
            <label>
              <span>Chain</span>
              <select value={chainId} onChange={(event) => setChainId(event.target.value)}>
                <option value="ethereum">Ethereum</option>
                <option value="solana">Solana</option>
                <option value="base">Base</option>
                <option value="bsc">BNB Chain</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="polygon">Polygon</option>
                <option value="optimism">Optimism</option>
                <option value="avalanche">Avalanche</option>
              </select>
            </label>
            <label>
              <span>Token address</span>
              <input value={tokenAddress} onChange={(event) => setTokenAddress(event.target.value)} placeholder="0x... or Solana address" />
              {tokenLookupStatus ? (
                <small className="watchlist-lookup-status">
                  {tokenLookupLoading ? <Loader2 size={13} className="watchlist-spin" /> : null}
                  {tokenLookupStatus}
                </small>
              ) : null}
            </label>
            <div className="watchlist-form-grid">
              <label>
                <span>Symbol</span>
                <input value={tokenSymbol} onChange={(event) => setTokenSymbol(event.target.value)} placeholder={tokenLookupLoading ? 'Looking up...' : 'Optional'} />
              </label>
              <label>
                <span>Name</span>
                <input value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder={tokenLookupLoading ? 'Looking up...' : 'Optional'} />
              </label>
            </div>
            <button className="watchlist-primary-button" type="button" onClick={addToken} disabled={pending}>
              {pending ? <Loader2 size={17} className="watchlist-spin" /> : <Plus size={17} />}
              Add Token
            </button>
          </div>
        ) : (
          <div className="watchlist-form">
            <label>
              <span>Coin search</span>
              <input value={coinQuery} onChange={(event) => setCoinQuery(event.target.value)} placeholder="Search BTC, ETH, SOL..." />
            </label>
            <div className="watchlist-coin-results">
              {coinResults.length ? coinResults.map((coin) => (
                <button type="button" key={coin.id} onClick={() => void addCoin(coin)} disabled={pending}>
                  <span className="watchlist-asset-logo">{coin.image ? <img src={coin.image} alt="" /> : coin.symbol.slice(0, 2)}</span>
                  <span><strong>{coin.name}</strong><small>{coin.symbol}</small></span>
                  <em>{formatUsd(coin.marketCapUsd)}</em>
                </button>
              )) : <p className="watchlist-muted">Search for a coin to add it.</p>}
            </div>
          </div>
        )}

        {error ? <div className="watchlist-error compact-error">{error}</div> : null}
      </section>
    </div>
  );
}
