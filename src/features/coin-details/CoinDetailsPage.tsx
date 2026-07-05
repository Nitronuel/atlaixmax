import { ArrowLeft, Bell, Globe, Maximize2, RefreshCw, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IconType } from 'react-icons';
import { SiGithub, SiReddit, SiX } from 'react-icons/si';
import { useNavigate, useParams } from 'react-router-dom';
import type { CoinGeckoCoinDetails } from '../../shared/coingecko';
import { useAuth } from '../../contexts/AuthContext';
import { CoinFeedService } from '../overview/coin-feed-service';
import { formatInteger, formatPercentValue, formatPrice, formatUsd } from '../overview/overview-utils';
import { WatchlistService } from '../watchlist/watchlist-service';

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

function CoinSupplySnapshot({ coin }: { coin: CoinGeckoCoinDetails | null }) {
  const supplyValue = (value: unknown) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? formatInteger(numeric) : 'N/A';
  };
  const rows = [
    { label: 'Circulating supply', value: supplyValue(coin?.circulatingSupply) },
    { label: 'Total supply', value: supplyValue(coin?.totalSupply) },
    { label: 'All-time high', value: formatPrice(coin?.ath) },
    { label: 'All-time low', value: formatPrice(coin?.atl) }
  ];

  return (
    <div className="token-side-panel coin-supply-snapshot-panel" aria-label="Coin supply and price milestones">
      <h3>Supply Snapshot</h3>
      <div className="coin-supply-snapshot-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
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
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState('');
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
  }, [coinId]);

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
          <CoinSupplySnapshot coin={coin} />
        </aside>
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
