import { Activity, ArrowLeft, Bell, BookOpen, Copy, Droplets, ExternalLink, FileText, Globe, Maximize2, MessageCircle, Radar, RefreshCw, Rss, Scan, Star, X, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { IconType } from 'react-icons';
import { SiDiscord, SiFacebook, SiFarcaster, SiGithub, SiGitbook, SiInstagram, SiLinktree, SiMedium, SiNotion, SiReddit, SiSubstack, SiTelegram, SiThreads, SiTiktok, SiX, SiYoutube } from 'react-icons/si';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { BubblemapsScanReport, TokenHolder } from '../../shared/bubblemaps';
import { normalizeBubblemapsChain } from '../../shared/bubblemaps';
import { formatPercentValue, formatPrice, formatUsd } from '../overview/overview-utils';
import { formatCompact, formatPercent } from '../safe-scan/format';
import { supplyPercentField, walletAddress, walletBalance } from '../safe-scan/safe-scan-data';
import { WatchlistService } from '../watchlist/watchlist-service';
import { type DexPairDetails, type TokenTradeHistoryItem, TokenDetailsService } from './token-details-service';

function shortAddress(value?: string, head = 8, tail = 6) {
  if (!value) return 'N/A';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function getAgeLabel(timestamp?: number) {
  if (!timestamp) return 'N/A';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getSafeScanChain(chain?: string) {
  return normalizeBubblemapsChain(chain) || 'solana';
}

function getDexChartUrl(chain?: string, pairAddress?: string, theme: 'light' | 'dark' = 'dark') {
  if (!chain || !pairAddress) return '';
  const params = new URLSearchParams({
    embed: '1',
    theme,
    chartTheme: theme,
    trades: '0',
    info: '0',
    loadChartSettings: '0'
  });
  return `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}?${params.toString()}`;
}

function getDexPageUrl(chain?: string, pairAddress?: string) {
  if (!chain || !pairAddress) return '';
  return `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}`;
}

function bestExternalLinks(pair: DexPairDetails) {
  const links = [
    ...(pair.info?.websites || []).map((item) => ({ label: item.label || 'Website', url: item.url || '' })),
    ...(pair.info?.socials || []).map((item) => ({ label: item.type || 'Social', url: item.url || '' }))
  ].filter((item) => item.url);
  const unique = new Map<string, { label: string; url: string }>();
  links.forEach((link) => {
    const key = `${link.label}:${link.url}`.toLowerCase();
    if (!unique.has(key)) unique.set(key, link);
  });
  return [...unique.values()].slice(0, 4);
}

function HeroMarketStat({
  label,
  value,
  valueClass,
  detail,
  detailClass
}: {
  label: string;
  value: string;
  valueClass?: 'positive' | 'negative';
  detail?: string;
  detailClass?: 'positive' | 'negative';
}) {
  return (
    <div className="token-detail-market-stat">
      <span>{label}</span>
      <strong className={valueClass || ''}>{value}</strong>
      {detail ? <small className={detailClass || ''}>{detail}</small> : null}
    </div>
  );
}

function getProjectBrandIcon(label: string, url: string): IconType | null {
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedUrl = url.toLowerCase();
  if (/^(website|site|homepage|home|official website)$/.test(normalizedLabel)) return null;
  if (/^(x|twitter)$/.test(normalizedLabel)) return SiX;
  if (normalizedLabel === 'discord') return SiDiscord;
  if (normalizedLabel === 'telegram') return SiTelegram;
  if (normalizedLabel === 'youtube') return SiYoutube;
  if (normalizedLabel === 'instagram') return SiInstagram;
  if (normalizedLabel === 'tiktok') return SiTiktok;
  if (normalizedLabel === 'github') return SiGithub;
  if (normalizedLabel === 'gitbook') return SiGitbook;
  if (normalizedLabel === 'facebook') return SiFacebook;
  if (normalizedLabel === 'reddit') return SiReddit;
  if (normalizedLabel === 'threads') return SiThreads;
  if (/^(farcaster|warpcast)$/.test(normalizedLabel)) return SiFarcaster;
  if (normalizedLabel === 'linktree') return SiLinktree;
  if (normalizedLabel === 'notion') return SiNotion;
  if (normalizedLabel === 'medium') return SiMedium;
  if (normalizedLabel === 'substack') return SiSubstack;
  if (/\bx\.com\b|twitter/.test(normalizedUrl)) return SiX;
  if (/discord/.test(normalizedUrl)) return SiDiscord;
  if (/telegram|t\.me/.test(normalizedUrl)) return SiTelegram;
  if (/youtube|youtu\.be/.test(normalizedUrl)) return SiYoutube;
  if (/instagram/.test(normalizedUrl)) return SiInstagram;
  if (/tiktok/.test(normalizedUrl)) return SiTiktok;
  if (/github/.test(normalizedUrl)) return SiGithub;
  if (/gitbook/.test(normalizedUrl)) return SiGitbook;
  if (/facebook|fb\.com/.test(normalizedUrl)) return SiFacebook;
  if (/reddit/.test(normalizedUrl)) return SiReddit;
  if (/threads/.test(normalizedUrl)) return SiThreads;
  if (/farcaster|warpcast/.test(normalizedUrl)) return SiFarcaster;
  if (/linktr\.ee|linktree/.test(normalizedUrl)) return SiLinktree;
  if (/notion/.test(normalizedUrl)) return SiNotion;
  if (/medium/.test(normalizedUrl)) return SiMedium;
  if (/substack/.test(normalizedUrl)) return SiSubstack;
  return null;
}

function ProjectLinkIcon({ label, url }: { label: string; url: string }) {
  const Icon = getProjectBrandIcon(label, url);
  if (Icon) return <Icon size={17} aria-hidden="true" focusable="false" />;

  const value = `${label} ${url}`.toLowerCase();
  if (/mirror|blog/.test(value)) return <BookOpen size={17} />;
  if (/docs|whitepaper|paper/.test(value)) return <FileText size={17} />;
  if (/rss/.test(value)) return <Rss size={17} />;
  if (/social|community|chat/.test(value)) return <MessageCircle size={17} />;
  return <Globe size={17} />;
}

function changeAccent(value: unknown): 'positive' | 'negative' | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric >= 0 ? 'positive' : 'negative';
}

function formatTradeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function formatTradeAge(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return 'N/A';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds || 1} second${elapsedSeconds === 1 ? '' : 's'} ago`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

function scannerTopHolders(report: BubblemapsScanReport) {
  const rows = report.endpoints.holders.data || report.endpoints.map.data?.nodes?.top_holders || [];
  return Array.isArray(rows) ? rows : [];
}

function getExplorerAddressUrl(chain: string, address: string) {
  const normalized = normalizeBubblemapsChain(chain);
  if (!address) return '';
  if (normalized === 'solana') return `https://solscan.io/account/${encodeURIComponent(address)}`;
  if (normalized === 'eth') return `https://etherscan.io/address/${encodeURIComponent(address)}`;
  if (normalized === 'base') return `https://basescan.org/address/${encodeURIComponent(address)}`;
  if (normalized === 'bsc') return `https://bscscan.com/address/${encodeURIComponent(address)}`;
  if (normalized === 'arbitrum') return `https://arbiscan.io/address/${encodeURIComponent(address)}`;
  if (normalized === 'polygon') return `https://polygonscan.com/address/${encodeURIComponent(address)}`;
  if (normalized === 'avalanche') return `https://snowtrace.io/address/${encodeURIComponent(address)}`;
  return '';
}

export function TokenDetailsPage() {
  const { address = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const chain = searchParams.get('chain') || '';
  const preferredPair = searchParams.get('pair') || '';
  const [pair, setPair] = useState<DexPairDetails | null>(null);
  const [poolCount, setPoolCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [chartLoaded, setChartLoaded] = useState(false);
  const [chartTimedOut, setChartTimedOut] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [marketPanelTab, setMarketPanelTab] = useState<'activity' | 'holders'>('activity');
  const [topHolders, setTopHolders] = useState<TokenHolder[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [holdersError, setHoldersError] = useState('');
  const [tokenTrades, setTokenTrades] = useState<TokenTradeHistoryItem[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesError, setTradesError] = useState('');
  const [tradesRefreshKey, setTradesRefreshKey] = useState(0);
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState('');
  const [chartTheme, setChartTheme] = useState<'light' | 'dark'>(() => (
    typeof document !== 'undefined' && document.documentElement.dataset.atlaixTheme === 'dark' ? 'dark' : 'light'
  ));

  useEffect(() => {
    const updateTheme = () => setChartTheme(document.documentElement.dataset.atlaixTheme === 'dark' ? 'dark' : 'light');
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-atlaix-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setChartLoaded(false);
    setWatchlistMessage('');

    TokenDetailsService.getToken(address, chain, preferredPair)
      .then((response) => {
        if (cancelled) return;
        setPair(response.pair);
        setPoolCount(response.poolCount || 0);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(nextError instanceof Error ? nextError.message : 'Token details are unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, chain, preferredPair]);

  useEffect(() => {
    setChartLoaded(false);
    setChartTimedOut(false);
  }, [pair?.pairAddress, chartTheme]);

  const token = pair?.baseToken;
  const symbol = token?.symbol || 'TOKEN';
  const name = token?.name || 'Token details';
  const tokenAddress = token?.address || address;
  const buys24h = Number(pair?.txns?.h24?.buys || 0);
  const sells24h = Number(pair?.txns?.h24?.sells || 0);
  const totalTxns = buys24h + sells24h;
  const volume24h = Number(pair?.volume?.h24 || 0);
  const buyVolume = totalTxns > 0 ? volume24h * (buys24h / totalTxns) : volume24h / 2;
  const sellVolume = Math.max(0, volume24h - buyVolume);
  const netFlow = buyVolume - sellVolume;
  const change24h = pair?.priceChange?.h24;
  const marketCap = Number(pair?.marketCap || pair?.fdv || 0);
  const heroMarketStats = [
    { label: 'Price (24h)', value: formatPrice(pair?.priceUsd), detail: formatPercentValue(change24h), detailClass: changeAccent(change24h) },
    { label: 'Market cap', value: formatUsd(marketCap) },
    { label: 'Liquidity', value: formatUsd(pair?.liquidity?.usd) },
    { label: 'Volume 24h', value: formatUsd(volume24h) }
  ];
  const imageUrl = pair?.info?.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(symbol)}&background=0f5132&color=fff`;
  const chartUrl = getDexChartUrl(pair?.chainId, pair?.pairAddress, chartTheme);
  const expandedChartUrl = getDexChartUrl(pair?.chainId, pair?.pairAddress, chartTheme);
  const dexPageUrl = pair?.url || getDexPageUrl(pair?.chainId, pair?.pairAddress);

  useEffect(() => {
    if (!chartUrl || chartLoaded) {
      setChartTimedOut(false);
      return;
    }

    const timer = window.setTimeout(() => setChartTimedOut(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [chartLoaded, chartUrl]);

  const holderNetwork = normalizeBubblemapsChain(pair?.chainId || chain);
  const externalLinks = useMemo(() => pair ? bestExternalLinks(pair) : [], [pair]);
  const quickActions = [
    {
      icon: Scan,
      title: 'Safe Scan',
      subtitle: 'Identify threats',
      path: `/safe-scan?chain=${encodeURIComponent(getSafeScanChain(pair?.chainId || chain))}&address=${encodeURIComponent(tokenAddress)}&autoScan=1`
    },
    {
      icon: Radar,
      title: 'Detection',
      subtitle: 'AI pattern scan',
      path: `/detection/token/${encodeURIComponent(tokenAddress)}?chain=${encodeURIComponent(pair?.chainId || chain)}`
    },
    {
      icon: Bell,
      title: 'Alerts',
      subtitle: 'Smart alerts',
      path: `/smart-alerts?chain=${encodeURIComponent(pair?.chainId || chain)}&address=${encodeURIComponent(tokenAddress)}`
    }
  ];
  const intelligenceRows = [
    { icon: Droplets, label: 'LP Pools', value: poolCount ? `${poolCount} Active` : 'N/A', valueClass: '' },
    { icon: ExternalLink, label: 'DEX', value: pair?.dexId || 'N/A', valueClass: '' },
    { icon: Activity, label: 'Quote', value: pair?.quoteToken?.symbol || 'N/A', valueClass: '' },
    { icon: Activity, label: 'Volume (24H)', value: formatUsd(volume24h), valueClass: '' },
    { icon: Zap, label: 'Net Volume Delta', value: `${netFlow >= 0 ? '+' : ''}${formatUsd(netFlow)}`, valueClass: netFlow >= 0 ? 'positive' : 'negative' },
    { icon: Activity, label: 'Buy / Sell Volume', value: `${formatUsd(buyVolume)} / ${formatUsd(sellVolume)}`, valueClass: '' },
    { icon: Activity, label: 'Age', value: getAgeLabel(pair?.pairCreatedAt), valueClass: '' }
  ];

  useEffect(() => {
    if (!holderNetwork || !tokenAddress) {
      setTopHolders([]);
      setHoldersError('');
      setHoldersLoading(false);
      return;
    }

    let cancelled = false;
    setHoldersLoading(true);
    setHoldersError('');

    TokenDetailsService.getBubblemapsReport(holderNetwork, tokenAddress)
      .then((report) => {
        if (cancelled) return;
        setTopHolders(scannerTopHolders(report));
      })
      .catch((nextError) => {
        if (cancelled) return;
        setTopHolders([]);
        setHoldersError(nextError instanceof Error ? nextError.message : 'Top holder data is unavailable.');
      })
      .finally(() => {
        if (!cancelled) setHoldersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [holderNetwork, tokenAddress]);

  useEffect(() => {
    const tradeChain = pair?.chainId || chain;
    const tradePair = pair?.pairAddress || preferredPair;
    if (!tradeChain || !tradePair || !tokenAddress || !pair) {
      setTokenTrades([]);
      setTradesError('');
      setTradesLoading(false);
      return;
    }

    let cancelled = false;
    setTradesLoading(true);
    setTradesError('');

    TokenDetailsService.getTokenTrades(tokenAddress, tradeChain, tradePair)
      .then((response) => {
        if (!cancelled) setTokenTrades(response.trades);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setTokenTrades([]);
        setTradesError(nextError instanceof Error ? nextError.message : 'Trade history is unavailable.');
      })
      .finally(() => {
        if (!cancelled) setTradesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chain, pair, preferredPair, tokenAddress, tradesRefreshKey]);

  function copyAddress() {
    if (!tokenAddress) return;
    void navigator.clipboard?.writeText(tokenAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function addToWatchlist() {
    if (!pair || !tokenAddress) return;
    if (!user) {
      navigate('/login');
      return;
    }

    const priceUsd = Number(pair.priceUsd);
    setWatchlistSaving(true);
    setWatchlistMessage('');
    try {
      await WatchlistService.createAsset({
        assetType: 'token',
        chainId: pair.chainId || chain || null,
        tokenAddress,
        pairAddress: pair.pairAddress || preferredPair || null,
        symbol,
        name,
        imageUrl: pair.info?.imageUrl || null,
        priceUsd: Number.isFinite(priceUsd) ? priceUsd : null,
        priceChange24h: pair.priceChange?.h24 ?? null,
        liquidityUsd: pair.liquidity?.usd ?? null,
        monitorSettings: WatchlistService.defaultMonitors,
        state: pair.dexId || 'DEX Market'
      });
      setWatchlistMessage('Added to Watchlist');
    } catch (nextError) {
      setWatchlistMessage(nextError instanceof Error ? nextError.message : 'Token could not be added.');
    } finally {
      setWatchlistSaving(false);
    }
  }

  if (loading && !pair) {
    return (
      <div className="token-details-state">
        <RefreshCw size={26} className="spin" />
        <span>Loading token details</span>
      </div>
    );
  }

  if (error && !pair) {
    return (
      <div className="token-details-state">
        <strong>{error}</strong>
        <button type="button" onClick={() => navigate('/dashboard')}>Back to dashboard</button>
      </div>
    );
  }

  return (
    <div className="token-details-page">
      <button className="token-detail-back" type="button" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        Back to market
      </button>

      <section className="token-detail-hero">
        <div className="token-detail-identity">
          <img src={imageUrl} alt="" onError={(event) => { event.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(symbol)}&background=0f5132&color=fff`; }} />
          <div className="token-detail-copy">
            <div className="token-detail-copy-main">
              <div className="token-detail-title-row">
                <h2>{name}</h2>
                <span>{symbol}</span>
                <em>{pair?.chainId || chain}</em>
              </div>
              <button type="button" onClick={copyAddress} className="token-detail-address">
                <span className="token-detail-address-full">{shortAddress(tokenAddress, 14, 10)}</span>
                <span className="token-detail-address-compact">{shortAddress(tokenAddress, 7, 5)}</span>
                <Copy size={14} />
                {copied ? <b>Copied</b> : null}
              </button>
            </div>
            <div className="token-project-icons" aria-label="Project links">
              {externalLinks.map((link) => (
                <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer" aria-label={link.label} title={link.label}>
                  <ProjectLinkIcon label={link.label} url={link.url} />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="token-detail-hero-market" aria-label="Token market snapshot">
          <div className="token-detail-market-strip">
            {heroMarketStats.map((stat) => (
              <HeroMarketStat
                key={stat.label}
                label={stat.label}
                value={stat.value}
                detail={stat.detail}
                detailClass={stat.detailClass}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="token-detail-grid token-chart-layout">
        <div className="token-chart-panel">
          <div className="token-chart-frame">
            {!chartLoaded && chartUrl && !chartTimedOut ? (
              <div className="token-chart-loading">
                <RefreshCw size={22} className="spin" />
                <span>Loading chart</span>
              </div>
            ) : null}
            {chartTimedOut ? (
              <div className="token-chart-empty token-chart-timeout">
                <strong>Chart is taking too long to load.</strong>
                {dexPageUrl ? <a href={dexPageUrl} target="_blank" rel="noreferrer">Open chart on DexScreener</a> : null}
              </div>
            ) : chartUrl ? (
              <iframe
                key={`${chartUrl}-${chartTheme}`}
                title={`${symbol} chart`}
                src={chartUrl}
                onLoad={() => {
                  setChartLoaded(true);
                  setChartTimedOut(false);
                }}
                allow="clipboard-write"
              />
            ) : (
              <div className="token-chart-empty">Chart unavailable for this pair.</div>
            )}
            <div className="token-chart-actions">
              <button type="button" onClick={() => setChartExpanded(true)} disabled={!chartUrl}>
                <Maximize2 size={16} />
                Full chart
              </button>
            </div>
          </div>
        </div>

        <aside className="token-detail-side">
          <div className="token-side-panel token-quick-actions-panel">
            <h3>Quick Actions</h3>
            <button type="button" className="token-quick-action-button" onClick={addToWatchlist} disabled={watchlistSaving || !tokenAddress || !pair}>
              <span className="token-quick-action-icon"><Star size={18} /></span>
              <span><strong>{watchlistSaving ? 'Adding' : 'Add to Watchlist'}</strong><small>Track this token</small></span>
            </button>
            {quickActions.map((action) => (
              <button key={action.title} type="button" className="token-quick-action-button" onClick={() => navigate(action.path)} disabled={!tokenAddress}>
                <span className="token-quick-action-icon"><action.icon size={18} /></span>
                <span><strong>{action.title}</strong><small>{action.subtitle}</small></span>
              </button>
            ))}
            {watchlistMessage ? <div className="token-action-note">{watchlistMessage}</div> : null}
          </div>
        </aside>
      </section>

      <section className="token-main-detail-grid">
        <div className="token-left-stack">
          <div className="token-intelligence-panel">
            <h3>Token Intelligence</h3>
            <div className="token-intelligence-list">
              {intelligenceRows.map((item) => (
                <div key={item.label} className="token-intelligence-row">
                  <span className="token-intelligence-copy">
                    <span className="token-intelligence-icon"><item.icon size={16} /></span>
                    <span>{item.label}</span>
                  </span>
                  <strong className={item.valueClass}>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>

        </div>

        <div className="atlaix-folder-shell token-market-panel-shell">
          <div className="token-folder-toolbar">
            <div className="atlaix-folder-strip">
              {[
                { id: 'activity' as const, label: 'On Chain Activities' },
                { id: 'holders' as const, label: 'Top Holders' }
              ].map((tab, index) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMarketPanelTab(tab.id)}
                  className={`atlaix-folder-tab ${marketPanelTab === tab.id ? 'is-active' : 'is-idle'} ${index === 0 ? 'is-first' : ''}`}
                >
                  <span className="atlaix-folder-label">{tab.label}</span>
                </button>
              ))}
            </div>
            {marketPanelTab === 'activity' ? (
              <div className="token-table-tools">
                <button type="button" title="Refresh activity" onClick={() => setTradesRefreshKey((current) => current + 1)} disabled={tradesLoading}>
                  <RefreshCw size={14} className={tradesLoading ? 'spin' : ''} />
                </button>
              </div>
            ) : null}
          </div>
          <div className="atlaix-folder-panel">
            <div className="atlaix-folder-accent" />
            {marketPanelTab === 'activity' ? (
              <div className="token-activity-shell">
                <div className="token-activity-head">
                  <span>Type</span>
                  <span>Time</span>
                  <span>Wallet</span>
                  <span>Amount</span>
                  <span>Value</span>
                  <span>Age</span>
                  <span>Tx</span>
                </div>
                {tradesLoading ? (
                  <div className="token-holder-empty">
                    <RefreshCw size={20} className="spin" />
                    <span>Loading $1K+ token trades</span>
                  </div>
                ) : tradesError ? (
                  <div className="token-holder-empty">{tradesError}</div>
                ) : tokenTrades.length ? (
                  <div className="token-activity-rows">
                    {tokenTrades.map((trade) => (
                      <div className={`token-activity-row ${trade.kind}`} key={trade.id}>
                        <span className="token-activity-kind">{trade.kind}</span>
                        <span>{formatTradeTime(trade.timestamp)}</span>
                        <span className="token-activity-wallet">{shortAddress(trade.trader, 7, 5)}</span>
                        <span>{trade.tokenAmount !== null ? formatCompact(trade.tokenAmount) : 'N/A'} {symbol}</span>
                        <span>{formatUsd(trade.volumeUsd)}</span>
                        <span>{formatTradeAge(trade.timestamp)}</span>
                        <span>
                          {trade.explorerUrl ? (
                            <a className="token-activity-link" href={trade.explorerUrl} target="_blank" rel="noreferrer" aria-label="Open transaction">
                              <ExternalLink size={15} />
                            </a>
                          ) : (
                            <span className="token-holder-action-empty">N/A</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="token-holder-empty">
                    No buy or sell transactions above $1K were found in the latest pool trades.
                  </div>
                )}
              </div>
            ) : (
              <div className="token-holders-shell">
                <div className="token-holders-head">
                  <span>Rank</span>
                  <span>Wallet</span>
                  <span>Amount</span>
                  <span>Value</span>
                  <span>Supply</span>
                  <span>Action</span>
                </div>
                {holdersLoading ? (
                  <div className="token-holder-empty">
                    <RefreshCw size={20} className="spin" />
                    <span>Loading Bubblemaps holders</span>
                  </div>
                ) : holdersError ? (
                  <div className="token-holder-empty">{holdersError}</div>
                ) : topHolders.length ? (
                  <div className="token-holder-rows">
                    {topHolders.map((holder, index) => {
                      const holderAddress = walletAddress(holder);
                      const balance = walletBalance(holder);
                      const value = Number(pair?.priceUsd || 0) * balance;
                      const explorerUrl = getExplorerAddressUrl(pair?.chainId || chain, holderAddress);
                      return (
                        <div className="token-holder-row" key={holderAddress || index}>
                          <span>#{index + 1}</span>
                          <span className="token-holder-wallet">
                            <strong>{shortAddress(holderAddress, 10, 7)}</strong>
                          </span>
                          <span>{formatCompact(balance)}</span>
                          <span>{Number.isFinite(value) && value > 0 ? formatUsd(value) : 'N/A'}</span>
                          <span>{formatPercent(supplyPercentField(holder))}</span>
                          <span>
                            {explorerUrl ? (
                              <a href={explorerUrl} target="_blank" rel="noreferrer">View</a>
                            ) : (
                              <span className="token-holder-action-empty">N/A</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="token-holder-empty">Top holder data is not available for this token yet.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {chartExpanded ? (
        <div className="token-chart-modal" role="dialog" aria-modal="true" aria-label={`${symbol} expanded chart`}>
          <button type="button" className="token-chart-scrim" onClick={() => setChartExpanded(false)} aria-label="Close chart" />
          <div>
            <header>
              <strong>{symbol} Full Chart</strong>
              <button type="button" onClick={() => setChartExpanded(false)} aria-label="Close chart"><X size={18} /></button>
            </header>
            {expandedChartUrl ? <iframe title={`${symbol} full chart`} src={expandedChartUrl} allow="clipboard-write" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
