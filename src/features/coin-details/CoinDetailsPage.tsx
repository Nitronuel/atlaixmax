import { Activity, ArrowLeft, BarChart3, Bell, ExternalLink, Globe, Maximize2, RefreshCw, Star, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IconType } from 'react-icons';
import { SiGithub, SiReddit, SiX } from 'react-icons/si';
import { useNavigate, useParams } from 'react-router-dom';
import type { CoinGeckoCoinDetails } from '../../shared/coingecko';
import { useAuth } from '../../contexts/AuthContext';
import { CoinFeedService } from '../overview/coin-feed-service';
import { formatInteger, formatPercentValue, formatPrice, formatUsd } from '../overview/overview-utils';
import { WatchlistService } from '../watchlist/watchlist-service';

type CoinPanelTab = 'market' | 'supply' | 'performance' | 'links';

const TRADINGVIEW_SYMBOLS: Record<string, string> = {
  'bitcoin': 'BINANCE:BTCUSDT',
  'ethereum': 'BINANCE:ETHUSDT',
  'binancecoin': 'BINANCE:BNBUSDT',
  'solana': 'BINANCE:SOLUSDT',
  'ripple': 'BINANCE:XRPUSDT',
  'cardano': 'BINANCE:ADAUSDT',
  'dogecoin': 'BINANCE:DOGEUSDT',
  'tron': 'BINANCE:TRXUSDT',
  'polkadot': 'BINANCE:DOTUSDT',
  'chainlink': 'BINANCE:LINKUSDT',
  'avalanche-2': 'BINANCE:AVAXUSDT',
  'sui': 'BINANCE:SUIUSDT',
  'the-open-network': 'OKX:TONUSDT',
  'stellar': 'BINANCE:XLMUSDT',
  'litecoin': 'BINANCE:LTCUSDT',
  'bitcoin-cash': 'BINANCE:BCHUSDT',
  'uniswap': 'BINANCE:UNIUSDT',
  'aave': 'BINANCE:AAVEUSDT',
  'near': 'BINANCE:NEARUSDT',
  'aptos': 'BINANCE:APTUSDT',
  'arbitrum': 'BINANCE:ARBUSDT',
  'optimism': 'BINANCE:OPUSDT',
  'pepe': 'BINANCE:PEPEUSDT',
  'shiba-inu': 'BINANCE:SHIBUSDT',
  'official-trump': 'BINANCE:TRUMPUSDT',
  'usd-coin': 'COINBASE:USDCUSD',
  'tether': 'CRYPTOCAP:USDT',
  'staked-ether': 'CRYPTOCAP:STETH',
  'wrapped-bitcoin': 'BINANCE:WBTCUSDT'
};

function MetricTile({ label, value, accent }: { label: string; value: string; accent?: 'positive' | 'negative' }) {
  return (
    <div className="token-detail-metric">
      <span>{label}</span>
      <strong className={accent || ''}>{value}</strong>
    </div>
  );
}

function changeAccent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric >= 0 ? 'positive' : 'negative';
}

function tradingViewSymbol(coinId: string, symbol: string) {
  const mapped = TRADINGVIEW_SYMBOLS[coinId.toLowerCase()];
  if (mapped) return mapped;
  const normalized = symbol.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return normalized ? `BINANCE:${normalized}USDT` : 'BINANCE:BTCUSDT';
}

function tradingViewEmbedUrl(coinId: string, symbol: string, theme: 'light' | 'dark') {
  const config = {
    autosize: true,
    symbol: tradingViewSymbol(coinId, symbol),
    interval: '60',
    timezone: 'Etc/UTC',
    theme,
    style: '1',
    locale: 'en',
    allow_symbol_change: true,
    calendar: false,
    details: false,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    hotlist: false,
    support_host: 'https://www.tradingview.com',
    withdateranges: true,
    width: '100%',
    height: '100%'
  };
  return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(config))}`;
}

function TradingViewCoinChart({ coinId, symbol, theme }: { coinId: string; symbol: string; theme: 'light' | 'dark' }) {
  const [loading, setLoading] = useState(true);
  const src = tradingViewEmbedUrl(coinId, symbol, theme);

  useEffect(() => {
    setLoading(true);
    const fallback = window.setTimeout(() => setLoading(false), 3200);
    return () => {
      window.clearTimeout(fallback);
    };
  }, [src]);

  return (
    <div className="coin-tradingview-chart" aria-label={`${symbol} TradingView chart`}>
      <iframe
        key={src}
        title={`${symbol} TradingView chart`}
        src={src}
        loading="eager"
        allow="fullscreen"
        onLoad={() => setLoading(false)}
      />
      {loading ? (
        <div className="token-chart-loading">
          <RefreshCw size={22} className="spin" />
          <span>Loading TradingView chart</span>
        </div>
      ) : null}
    </div>
  );
}

function getCoinLinkIcon(label: string, url: string): IconType | null {
  const normalizedLabel = label.trim().toLowerCase();
  const normalizedUrl = url.toLowerCase();
  if (/^(x|twitter)$/.test(normalizedLabel) || /\bx\.com\b|twitter/.test(normalizedUrl)) return SiX;
  if (normalizedLabel === 'reddit' || /reddit/.test(normalizedUrl)) return SiReddit;
  if (normalizedLabel === 'github' || /github/.test(normalizedUrl)) return SiGithub;
  return null;
}

function CoinLinkIcon({ label, url }: { label: string; url: string }) {
  const Icon = getCoinLinkIcon(label, url);
  if (Icon) return <Icon size={17} aria-hidden="true" focusable="false" />;
  return <Globe size={17} />;
}

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined) {
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= 0) return 'N/A';
  return formatPercentValue((top / bottom) * 100);
}

function CoinPanelRows({ coin, tab }: { coin: CoinGeckoCoinDetails | null; tab: CoinPanelTab }) {
  if (tab === 'supply') {
    return (
      <div className="coin-folder-grid">
        <div><span>Circulating supply</span><strong>{formatInteger(coin?.circulatingSupply)}</strong></div>
        <div><span>Total supply</span><strong>{formatInteger(coin?.totalSupply)}</strong></div>
        <div><span>Max supply</span><strong>{formatInteger(coin?.maxSupply)}</strong></div>
        <div><span>Circulating / max</span><strong>{safeRatio(coin?.circulatingSupply, coin?.maxSupply)}</strong></div>
      </div>
    );
  }

  if (tab === 'performance') {
    return (
      <div className="coin-folder-grid">
        <div><span>1h change</span><strong className={changeAccent(coin?.change1h)}>{formatPercentValue(coin?.change1h)}</strong></div>
        <div><span>24h change</span><strong className={changeAccent(coin?.change24h)}>{formatPercentValue(coin?.change24h)}</strong></div>
        <div><span>7d change</span><strong className={changeAccent(coin?.change7d)}>{formatPercentValue(coin?.change7d)}</strong></div>
        <div><span>30d change</span><strong className={changeAccent(coin?.change30d)}>{formatPercentValue(coin?.change30d)}</strong></div>
        <div><span>All-time high</span><strong>{formatPrice(coin?.ath)}</strong></div>
        <div><span>ATH distance</span><strong className={changeAccent(coin?.athChangePercentage)}>{formatPercentValue(coin?.athChangePercentage)}</strong></div>
        <div><span>All-time low</span><strong>{formatPrice(coin?.atl)}</strong></div>
        <div><span>ATL recovery</span><strong className={changeAccent(coin?.atlChangePercentage)}>{formatPercentValue(coin?.atlChangePercentage)}</strong></div>
      </div>
    );
  }

  if (tab === 'links') {
    const links = coin?.links || [];
    return links.length ? (
      <div className="coin-link-list">
        {links.map((link) => (
          <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer">
            <span><CoinLinkIcon label={link.label} url={link.url} /></span>
            <strong>{link.label}</strong>
            <ExternalLink size={15} />
          </a>
        ))}
      </div>
    ) : (
      <div className="token-holder-empty">CoinGecko has no verified project links for this coin.</div>
    );
  }

  return (
    <div className="coin-folder-grid">
      <div><span>Market cap</span><strong>{formatUsd(coin?.marketCapUsd)}</strong></div>
      <div><span>Fully diluted value</span><strong>{formatUsd(coin?.fdvUsd)}</strong></div>
      <div><span>24h volume</span><strong>{formatUsd(coin?.volume24hUsd)}</strong></div>
      <div><span>Market cap rank</span><strong>#{coin?.marketCapRank || 'N/A'}</strong></div>
      <div><span>CoinGecko read</span><strong>{coin?.event || 'Market Watch'}</strong></div>
      <div><span>Last seen</span><strong>{coin?.lastSeenAt ? new Date(coin.lastSeenAt).toLocaleString() : 'N/A'}</strong></div>
    </div>
  );
}

export function CoinDetailsPage() {
  const { coinId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [coin, setCoin] = useState<CoinGeckoCoinDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chartExpanded, setChartExpanded] = useState(false);
  const [panelTab, setPanelTab] = useState<CoinPanelTab>('market');
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState('');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [chartTheme, setChartTheme] = useState<'light' | 'dark'>(() => (
    typeof document !== 'undefined' && document.documentElement.dataset.atlaixTheme === 'dark' ? 'dark' : 'light'
  ));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setWatchlistMessage('');
    CoinFeedService.getCoin(coinId)
      .then((response) => {
        if (!cancelled) setCoin(response.coin);
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : 'Coin details are unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coinId, refreshVersion]);

  useEffect(() => {
    const updateTheme = () => setChartTheme(document.documentElement.dataset.atlaixTheme === 'dark' ? 'dark' : 'light');
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-atlaix-theme'] });
    return () => observer.disconnect();
  }, []);

  if (loading && !coin) {
    return (
      <div className="token-details-state">
        <RefreshCw size={26} className="spin" />
        <span>Loading coin details</span>
      </div>
    );
  }

  if (error && !coin) {
    return (
      <div className="token-details-state">
        <strong>{error}</strong>
        <button type="button" onClick={() => navigate('/dashboard')}>Back to dashboard</button>
      </div>
    );
  }

  const symbol = coin?.symbol || 'COIN';
  const name = coin?.name || 'Coin details';
  const tabs: Array<{ id: CoinPanelTab; label: string }> = [
    { id: 'market', label: 'Market' },
    { id: 'supply', label: 'Supply' },
    { id: 'performance', label: 'Performance' },
    { id: 'links', label: 'Links' }
  ];

  async function addToWatchlist() {
    if (!coin) return;
    if (!user) {
      navigate('/login');
      return;
    }

    setWatchlistSaving(true);
    setWatchlistMessage('');
    try {
      await WatchlistService.createAsset({
        assetType: 'coin',
        coinId: coin.id,
        symbol: coin.symbol,
        name: coin.name,
        imageUrl: coin.image || null,
        priceUsd: coin.priceUsd,
        priceChange24h: coin.change24h,
        monitorSettings: WatchlistService.defaultMonitors,
        state: coin.event
      });
      setWatchlistMessage('Added to Watchlist');
    } catch (nextError) {
      setWatchlistMessage(nextError instanceof Error ? nextError.message : 'Coin could not be added.');
    } finally {
      setWatchlistSaving(false);
    }
  }

  function openAlertSetup() {
    const params = new URLSearchParams({ setup: '1', type: 'price-target' });
    if (coin) {
      params.set('coin', coin.id);
      params.set('target', coin.symbol);
    }
    navigate(`/smart-alerts?${params.toString()}`);
  }

  return (
    <div className="token-details-page coin-details-page">
      <button className="token-detail-back" type="button" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        Back to market
      </button>

      <section className="token-detail-hero">
        <div className="token-detail-identity">
          <img src={coin?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(symbol)}&background=0f5132&color=fff`} alt="" />
          <div className="token-detail-copy">
            <div className="token-detail-copy-main">
              <div className="token-detail-title-row">
                <h2>{name}</h2>
                <span>{symbol}</span>
                <em>Rank #{coin?.marketCapRank || 'N/A'}</em>
              </div>
              <p>{coin?.event || 'CoinGecko market read'}</p>
            </div>
            <div className="token-project-icons" aria-label="Coin links">
              {(coin?.links || []).slice(0, 4).map((link) => (
                <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer" aria-label={link.label} title={link.label}>
                  <CoinLinkIcon label={link.label} url={link.url} />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="token-detail-hero-market">
          <div className="token-detail-hero-metrics">
            <MetricTile label="Price" value={formatPrice(coin?.priceUsd)} />
            <MetricTile label="Market cap" value={formatUsd(coin?.marketCapUsd)} />
            <MetricTile label="24h volume" value={formatUsd(coin?.volume24hUsd)} />
            <MetricTile label="FDV" value={formatUsd(coin?.fdvUsd)} />
          </div>
          <div className="token-change-panel token-change-panel-inline" aria-label="Price change">
            <MetricTile label="1h" value={formatPercentValue(coin?.change1h)} accent={changeAccent(coin?.change1h)} />
            <MetricTile label="24h" value={formatPercentValue(coin?.change24h)} accent={changeAccent(coin?.change24h)} />
            <MetricTile label="7d" value={formatPercentValue(coin?.change7d)} accent={changeAccent(coin?.change7d)} />
            <MetricTile label="30d" value={formatPercentValue(coin?.change30d)} accent={changeAccent(coin?.change30d)} />
          </div>
        </div>
      </section>

      <section className="token-detail-grid token-chart-layout">
        <div className="token-chart-panel coin-chart-panel">
          <div className="token-chart-frame">
            <TradingViewCoinChart coinId={coin?.id || coinId} symbol={symbol} theme={chartTheme} />
          </div>
          <div className="coin-chart-actions">
            <button type="button" className="coin-chart-full-button" onClick={() => setChartExpanded(true)} disabled={!coin}>
              <Maximize2 size={16} />
              Full chart
            </button>
          </div>
        </div>

        <aside className="token-detail-side">
          <div className="token-side-panel token-quick-actions-panel">
            <h3>Quick Actions</h3>
            <button type="button" className="token-quick-action-button" onClick={openAlertSetup} disabled={!coin}>
              <span className="token-quick-action-icon"><Bell size={18} /></span>
              <span><strong>Alert</strong><small>Create coin alert</small></span>
            </button>
            <button type="button" className="token-quick-action-button" onClick={addToWatchlist} disabled={watchlistSaving || !coin}>
              <span className="token-quick-action-icon"><Star size={18} /></span>
              <span><strong>{watchlistSaving ? 'Adding' : 'Add to Watchlist'}</strong><small>Track market coin</small></span>
            </button>
            {watchlistMessage ? <div className="coin-action-note">{watchlistMessage}</div> : null}
          </div>
        </aside>
      </section>

      <section className="token-main-detail-grid">
        <div className="token-left-stack">
          <div className="token-intelligence-panel">
            <h3>CoinGecko Profile</h3>
            <div className="coin-profile-copy">
              <p>{coin?.description || 'CoinGecko has limited profile text for this coin.'}</p>
              {coin?.categories?.length ? <div>{coin.categories.map((category) => <span key={category}>{category}</span>)}</div> : null}
            </div>
          </div>

          <div className="token-intelligence-panel">
            <h3>Market Snapshot</h3>
            <div className="token-intelligence-list">
              <div className="token-intelligence-row">
                <span className="token-intelligence-copy"><span className="token-intelligence-icon"><BarChart3 size={16} /></span><span>Rank</span></span>
                <strong>#{coin?.marketCapRank || 'N/A'}</strong>
              </div>
              <div className="token-intelligence-row">
                <span className="token-intelligence-copy"><span className="token-intelligence-icon"><Activity size={16} /></span><span>Read</span></span>
                <strong>{coin?.event || 'Market Watch'}</strong>
              </div>
              <div className="token-intelligence-row">
                <span className="token-intelligence-copy"><span className="token-intelligence-icon"><TrendingUp size={16} /></span><span>ATH</span></span>
                <strong>{formatPrice(coin?.ath)}</strong>
              </div>
              <div className="token-intelligence-row">
                <span className="token-intelligence-copy"><span className="token-intelligence-icon"><TrendingDown size={16} /></span><span>ATL</span></span>
                <strong>{formatPrice(coin?.atl)}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="atlaix-folder-shell token-market-panel-shell coin-market-panel-shell">
          <div className="token-folder-toolbar">
            <div className="atlaix-folder-strip">
              {tabs.map((tab, index) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPanelTab(tab.id)}
                  className={`atlaix-folder-tab ${panelTab === tab.id ? 'is-active' : 'is-idle'} ${index === 0 ? 'is-first' : ''}`}
                >
                  <span className="atlaix-folder-label">{tab.label}</span>
                </button>
              ))}
            </div>
            <div className="token-table-tools">
              <button type="button" onClick={() => setRefreshVersion((current) => current + 1)} title="Refresh CoinGecko market data">
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
              </button>
              <span>CoinGecko</span>
            </div>
          </div>
          <div className="atlaix-folder-panel">
            <div className="atlaix-folder-accent" />
            <CoinPanelRows coin={coin} tab={panelTab} />
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
            <div className="coin-chart-modal-frame">
              <TradingViewCoinChart coinId={coin?.id || coinId} symbol={symbol} theme={chartTheme} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
