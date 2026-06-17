import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CoinGeckoChartPoint, CoinGeckoCoinDetails } from '../../shared/coingecko';
import { CoinFeedService } from '../overview/coin-feed-service';
import { formatInteger, formatPercentValue, formatPrice, formatUsd } from '../overview/overview-utils';

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

function chartPath(points: CoinGeckoChartPoint[], width: number, height: number) {
  if (points.length < 2) return '';
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  return points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.price - min) / range) * height;
    return `${index ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function CoinChart({ points }: { points: CoinGeckoChartPoint[] }) {
  const width = 900;
  const height = 320;
  const path = useMemo(() => chartPath(points, width, height), [points]);
  const positive = points.length > 1 ? points[points.length - 1].price >= points[0].price : true;

  if (!path) return <div className="token-chart-empty">Chart data is unavailable for this coin.</div>;

  return (
    <div className="coin-chart-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="CoinGecko market chart">
        <defs>
          <linearGradient id="coinChartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={positive ? 'rgba(22, 143, 67, 0.24)' : 'rgba(219, 65, 88, 0.24)'} />
            <stop offset="100%" stopColor="rgba(22, 143, 67, 0)" />
          </linearGradient>
        </defs>
        <path d={`${path} L${width} ${height} L0 ${height} Z`} fill="url(#coinChartFill)" />
        <path d={path} className={positive ? 'positive' : 'negative'} />
      </svg>
    </div>
  );
}

export function CoinDetailsPage() {
  const { coinId = '' } = useParams();
  const navigate = useNavigate();
  const [coin, setCoin] = useState<CoinGeckoCoinDetails | null>(null);
  const [chart, setChart] = useState<CoinGeckoChartPoint[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
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
    let cancelled = false;
    setChartLoading(true);
    CoinFeedService.getChart(coinId, days)
      .then((response) => {
        if (!cancelled) setChart(response.prices);
      })
      .catch(() => {
        if (!cancelled) setChart([]);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coinId, days]);

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

  return (
    <div className="token-details-page coin-details-page">
      <button className="token-detail-back" type="button" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        Back to market
      </button>

      <section className="token-detail-hero">
        <div className="token-detail-identity">
          <img src={coin?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(symbol)}&background=0f5132&color=fff`} alt="" />
          <div>
            <div className="token-detail-title-row">
              <h2>{name}</h2>
              <span>{symbol}</span>
              <em>Rank #{coin?.marketCapRank || 'N/A'}</em>
            </div>
            <p>{coin?.event || 'CoinGecko market read'}</p>
          </div>
        </div>
        <div className="token-project-icons" aria-label="Coin links">
          {(coin?.links || []).map((link) => (
            <a key={`${link.label}:${link.url}`} href={link.url} target="_blank" rel="noreferrer" aria-label={link.label} title={link.label}>
              <ExternalLink size={17} />
            </a>
          ))}
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
        <div className="token-chart-panel">
          <div className="coin-chart-toolbar">
            {[1, 7, 30, 90, 365].map((item) => (
              <button key={item} type="button" className={days === item ? 'is-active' : ''} onClick={() => setDays(item)}>
                {item === 1 ? '1D' : item === 365 ? '1Y' : `${item}D`}
              </button>
            ))}
          </div>
          <div className="token-chart-frame">
            {chartLoading ? (
              <div className="token-chart-loading">
                <RefreshCw size={22} className="spin" />
                <span>Loading chart</span>
              </div>
            ) : null}
            <CoinChart points={chart} />
          </div>
        </div>
        <aside className="token-detail-side">
          <div className="token-side-panel token-quick-actions-panel">
            <h3>Coin Market</h3>
            <div className="token-intelligence-list">
              <div className="token-intelligence-row"><span>Circulating supply</span><strong>{formatInteger(coin?.circulatingSupply)}</strong></div>
              <div className="token-intelligence-row"><span>Total supply</span><strong>{formatInteger(coin?.totalSupply)}</strong></div>
              <div className="token-intelligence-row"><span>Max supply</span><strong>{formatInteger(coin?.maxSupply)}</strong></div>
              <div className="token-intelligence-row"><span>ATH</span><strong>{formatPrice(coin?.ath)}</strong></div>
              <div className="token-intelligence-row"><span>ATL</span><strong>{formatPrice(coin?.atl)}</strong></div>
            </div>
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
        </div>
      </section>
    </div>
  );
}
