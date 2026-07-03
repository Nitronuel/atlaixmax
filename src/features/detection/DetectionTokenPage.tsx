import { Activity, ArrowLeft, BarChart3, Bell, Compass, Copy, Scan, ShieldCheck, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { DetectionTokenAiAssessmentResponse, DetectionTokenDetailResponse } from '../../shared/detection';
import { detectionEventAssessmentForLabel } from '../../shared/detection-copy';
import { WatchlistService } from '../watchlist/watchlist-service';
import { DetectionService } from './detection-service';

type LooseClassification = {
  primaryLabel?: string;
  displayLabel?: string;
};

const GLOBAL_ASSISTANT_OPEN_EVENT = 'atlaix:open-global-assistant';

function formatUsd(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '$0';
  if (numberValue >= 1_000_000_000) return `$${(numberValue / 1_000_000_000).toFixed(2)}B`;
  if (numberValue >= 1_000_000) return `$${(numberValue / 1_000_000).toFixed(2)}M`;
  if (numberValue >= 1_000) return `$${(numberValue / 1_000).toFixed(1)}K`;
  return `$${numberValue.toFixed(0)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function formatMetricUsd(value: number | null) {
  return value === null ? 'N/A' : formatUsd(value);
}

function formatSignedUsd(value: number | null) {
  if (value === null) return 'N/A';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatPrice(value: number | null) {
  if (value === null) return 'N/A';
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 10 })}`;
}

function formatPercentChange(value: number | null) {
  if (value === null) return '';
  const sign = value > 0 ? '+' : '';
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  return `${sign}${value.toFixed(digits)}%`;
}

function changeTone(value: number | null) {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function formatEventTimestamp(value: number) {
  if (!Number.isFinite(value)) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}

function shortAddress(value?: string | null) {
  if (!value) return 'No address';
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function asClassification(value: unknown): LooseClassification | null {
  return value && typeof value === 'object' ? value as LooseClassification : null;
}

function humanizeLabel(value = '') {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relationshipLabel(value = '') {
  return humanizeLabel(value).replace('Sequential ', '');
}

export function DetectionTokenPage() {
  const { chain = '', address = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const pair = searchParams.get('pair') || '';
  const [detail, setDetail] = useState<DetectionTokenDetailResponse | null>(null);
  const [aiAssessment, setAiAssessment] = useState<DetectionTokenAiAssessmentResponse | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [watchlistSaving, setWatchlistSaving] = useState(false);
  const [watchlistMessage, setWatchlistMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    setAssessmentLoading(true);
    setError(null);
    setAiAssessment(null);
    setWatchlistMessage('');
    Promise.all([
      DetectionService.getToken(chain, address, pair),
      DetectionService.getTokenAiAssessment(chain, address, pair).catch(() => null)
    ])
      .then(([nextDetail, nextAssessment]) => {
        setDetail(nextDetail);
        setAiAssessment(nextAssessment);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Detection token details are unavailable.'))
      .finally(() => {
        setLoading(false);
        setAssessmentLoading(false);
      });
  }, [address, chain, pair]);

  const classification = asClassification(detail?.latestClassification);
  const token = detail?.token;
  const tokenSymbol = token?.tokenSymbol || token?.tokenName || 'Unknown';
  const tokenName = token?.tokenName && token?.tokenSymbol && token.tokenName !== token.tokenSymbol ? token.tokenName : tokenSymbol;
  const chainDex = [token?.chain, token?.dexId].filter(Boolean).join(' / ');
  const assessmentEvent = detail?.events[0]?.eventType || classification?.displayLabel || humanizeLabel(classification?.primaryLabel || '') || 'No primary event';
  const fallbackAssessment = detectionEventAssessmentForLabel(assessmentEvent, tokenName, `${tokenName}'s latest scan did not produce a clean directional event.`);
  const assessmentBadge = aiAssessment?.context?.relationship ? relationshipLabel(aiAssessment.context.relationship) : assessmentEvent;
  const structuredAssessment = aiAssessment?.assessment;
  const latestSnapshot = asRecord(detail?.latestSnapshot);
  const latestFeatures = asRecord(detail?.latestFeatures);
  const latestEvent = detail?.events[0] || null;
  const eventReadCount = aiAssessment?.events?.length || Math.min(detail?.events.length || 0, 5);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const events24h = detail?.events.filter((event) => Number(event.detectedAt) >= dayAgo).length || 0;
  const headerSentiment = aiAssessment?.context?.bias && aiAssessment.context.bias !== 'mixed'
    ? aiAssessment.context.bias
    : latestEvent?.sentiment || 'neutral';
  const marketBias = structuredAssessment?.marketBias || aiAssessment?.context?.marketBias || (latestEvent ? `${humanizeLabel(latestEvent.sentiment)} Bias` : '');
  const priceChange24h = firstNumber(latestSnapshot.priceChange24h, latestEvent?.metrics.priceChange24h);
  const netFlow = firstNumber(latestEvent?.metrics.netFlow);
  const activityLevel = events24h >= 5 ? 'Elevated' : events24h >= 2 ? 'Active' : events24h === 1 ? 'Fresh signal' : 'Quiet';
  const marketContextRows = [
    {
      icon: <Compass size={15} />,
      label: 'Market State',
      value: marketBias || aiAssessment?.context?.state || 'Unconfirmed',
      tone: headerSentiment
    },
    {
      icon: <BarChart3 size={15} />,
      label: 'Capital Flow',
      value: formatSignedUsd(netFlow),
      tone: changeTone(netFlow)
    },
    {
      icon: <Activity size={15} />,
      label: 'Activity Level',
      value: `${activityLevel} (${events24h} in 24h)`,
      tone: events24h >= 5 ? 'positive' : 'neutral'
    }
  ];
  const aiQuestions = [
    `Why is ${tokenSymbol} showing ${assessmentEvent.toLowerCase()}?`,
    `What would invalidate the ${headerSentiment} bias?`
  ];
  const marketStats = [
    {
      label: 'Price (24h)',
      value: formatPrice(firstNumber(latestSnapshot.priceUsd)),
      change: priceChange24h
    },
    {
      label: 'Market Cap',
      value: formatMetricUsd(firstNumber(latestSnapshot.marketCap, latestEvent?.metrics.marketCap)),
      change: null
    },
    {
      label: 'Liquidity',
      value: formatMetricUsd(firstNumber(latestSnapshot.liquidityUsd, latestEvent?.metrics.liquidity)),
      change: firstNumber(latestFeatures.liquidityChangePercentage)
    },
    {
      label: 'Volume (24h)',
      value: formatMetricUsd(firstNumber(latestSnapshot.volume24h, latestEvent?.metrics.volume24h)),
      change: null
    },
    {
      label: '24h Events',
      value: String(events24h),
      change: null,
      action: 'View events'
    }
  ];

  function copyValue(value?: string | null) {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value);
  }

  async function addToWatchlist() {
    if (!token) return;
    if (!user) {
      navigate('/login');
      return;
    }

    const priceUsd = firstNumber(latestSnapshot.priceUsd);
    setWatchlistSaving(true);
    setWatchlistMessage('');
    try {
      await WatchlistService.createAsset({
        assetType: 'token',
        chainId: token.chain || chain || null,
        tokenAddress: token.tokenAddress,
        pairAddress: token.pairAddress || pair || null,
        symbol: tokenSymbol,
        name: tokenName,
        imageUrl: token.logo || null,
        priceUsd,
        priceChange24h,
        liquidityUsd: firstNumber(latestSnapshot.liquidityUsd, latestEvent?.metrics.liquidity),
        monitorSettings: WatchlistService.defaultMonitors,
        state: marketBias || assessmentEvent
      });
      setWatchlistMessage('Added to Watchlist');
    } catch (nextError) {
      setWatchlistMessage(nextError instanceof Error ? nextError.message : 'Token could not be added.');
    } finally {
      setWatchlistSaving(false);
    }
  }

  function openAssistant(prompt?: string) {
    window.dispatchEvent(new CustomEvent(GLOBAL_ASSISTANT_OPEN_EVENT, {
      detail: { prompt }
    }));
  }

  if (loading) {
    return (
      <section className="detection-token-page">
        <div className="detection-token-state">Loading detection profile...</div>
      </section>
    );
  }

  if (error || !token) {
    return (
      <section className="detection-token-page">
        <Link className="detection-back-link" to="/detection"><ArrowLeft size={17} />Back to Detection</Link>
        <div className="detection-token-state">{error || 'No detection profile exists for this token yet.'}</div>
      </section>
    );
  }

  return (
    <section className="detection-token-page">
      <Link className="detection-back-link" to="/detection"><ArrowLeft size={17} />Back to Detection</Link>

      <header className="detection-token-hero">
        <div className="detection-token-profile">
          <div className="detection-token-logo-large">
            {token.logo ? <img src={token.logo} alt="" /> : <span>{tokenSymbol.slice(0, 2).toUpperCase()}</span>}
          </div>
          <div className="detection-token-profile-copy">
            <h2>{tokenName} <small>({tokenSymbol})</small></h2>
            {chainDex ? <p className="detection-token-network">{chainDex}</p> : null}
            <div className="detection-token-meta-row">
              <button type="button" onClick={() => copyValue(token.tokenAddress)} aria-label="Copy token address">
                {shortAddress(token.tokenAddress)} <Copy size={14} />
              </button>
            </div>
            <div className="detection-token-badges">
              {marketBias ? <span className={`detection-token-badge sentiment-${headerSentiment}`}>{marketBias}</span> : null}
              {eventReadCount ? <span className="detection-token-badge">{eventReadCount}-event read</span> : null}
            </div>
          </div>
        </div>
        <div className="detection-token-market-strip" aria-label="Latest token market snapshot">
          {marketStats.map((stat) => (
            <div className="detection-token-stat" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              {stat.change !== null ? (
                <small className={`metric-change-${changeTone(stat.change)}`}>{formatPercentChange(stat.change)}</small>
              ) : stat.action ? (
                <a href="#detection-event-history">{stat.action}</a>
              ) : null}
            </div>
          ))}
        </div>
      </header>

      <div className="detection-token-content-grid">
        <div className="detection-token-main-stack">
          <section className="detection-detail-panel detection-assessment-panel">
            <div className="detection-assessment-head">
              <span>AI Assessment</span>
              <div className="detection-assessment-badges">
                <strong>{assessmentBadge}</strong>
                {aiAssessment?.events?.length ? <strong>{aiAssessment.events.length}-event read</strong> : null}
              </div>
            </div>
            {assessmentLoading ? (
              <p className="detection-assessment-copy">Reading the latest Detection Engine events...</p>
            ) : structuredAssessment ? (
              <div className="detection-ai-assessment-body">
                <div className="detection-ai-summary">
                  <span>Summary</span>
                  <p>{structuredAssessment.summary}</p>
                </div>
                <div className="detection-ai-field-grid">
                  <div>
                    <span>Market Bias</span>
                    <strong>{structuredAssessment.marketBias}</strong>
                  </div>
                  <div>
                    <span>Invalidation</span>
                    <strong>{structuredAssessment.invalidation}</strong>
                  </div>
                </div>
                <div className="detection-ai-list-grid">
                  {structuredAssessment.supportingSignals.length ? (
                    <div>
                      <span>Supporting Signals</span>
                      <ul>
                        {structuredAssessment.supportingSignals.map((signal) => <li key={signal}>{signal}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {structuredAssessment.watchFor.length ? (
                    <div>
                      <span>Watch For</span>
                      <ul>
                        {structuredAssessment.watchFor.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="detection-assessment-copy">{fallbackAssessment}</p>
            )}
          </section>

          <section className="detection-detail-panel detection-timeline-panel" id="detection-event-history">
            <h3>{tokenName} Event History</h3>
            {detail.events.length ? (
              <div className="detection-token-timeline">
                {detail.events.map((event) => (
                  <article className={`detection-event-card detection-token-timeline-card sentiment-${event.sentiment}`} key={event.id}>
                    <header>
                      <div>
                        <ShieldCheck size={15} />
                        <strong>{event.eventType}</strong>
                      </div>
                      <time dateTime={new Date(event.detectedAt).toISOString()}>{formatEventTimestamp(event.detectedAt)}</time>
                    </header>
                    <p>{detectionEventAssessmentForLabel(event.eventType, tokenName, event.summary)}</p>
                    <footer>
                      <div className="detection-token">
                        {token.logo ? <img src={token.logo} alt="" /> : <span className="detection-token-fallback">{tokenSymbol.slice(0, 2).toUpperCase()}</span>}
                        <span>{tokenSymbol}</span>
                      </div>
                      <div className="detection-card-metrics">
                        <span className={`detection-sentiment sentiment-${event.sentiment}`}>{event.sentiment.toUpperCase()}</span>
                        <strong>{formatUsd(event.metrics.volume24h)}</strong>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            ) : <p>No event history exists for this token yet.</p>}
          </section>
        </div>

        <aside className="detection-token-side-rail">
          <nav className="detection-token-actions token-side-panel token-quick-actions-panel" aria-label="Token detection actions">
            <h3>Quick Actions</h3>
            <Link className="token-quick-action-button" to={`/token/${encodeURIComponent(token.tokenAddress)}?chain=${encodeURIComponent(token.chain)}&pair=${encodeURIComponent(token.pairAddress)}`}>
              <span className="token-quick-action-icon"><Activity size={18} /></span>
              <span><strong>Token Details</strong><small>Market data</small></span>
            </Link>
            <Link className="token-quick-action-button" to="/smart-alerts">
              <span className="token-quick-action-icon"><Bell size={18} /></span>
              <span><strong>Create Alert</strong><small>Smart Alerts</small></span>
            </Link>
            <Link className="token-quick-action-button" to="/safe-scan">
              <span className="token-quick-action-icon"><Scan size={18} /></span>
              <span><strong>Safe Scan</strong><small>Risk check</small></span>
            </Link>
            <button type="button" className="token-quick-action-button" onClick={addToWatchlist} disabled={watchlistSaving || !token}>
              <span className="token-quick-action-icon"><Star size={18} /></span>
              <span><strong>{watchlistSaving ? 'Adding' : 'Add to Watchlist'}</strong><small>Track this token</small></span>
            </button>
            {watchlistMessage ? <div className="token-action-note">{watchlistMessage}</div> : null}
          </nav>

          <section className="detection-market-context-card" aria-label="Market context">
            <div className="detection-side-card-heading">
              <small>Market Context</small>
              <h3>{tokenSymbol} market read</h3>
            </div>
            <div className="detection-market-context-list">
              {marketContextRows.map((item) => (
                <div className="detection-market-context-row" key={item.label}>
                  <span className="detection-market-context-icon">{item.icon}</span>
                  <span>{item.label}</span>
                  <strong className={`context-tone-${item.tone}`}>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section
            className="detection-ask-ai-card"
            aria-label="Ask Atlaix AI about this token"
            role="button"
            tabIndex={0}
            onClick={() => openAssistant()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openAssistant();
              }
            }}
          >
            <div className="detection-ask-ai-head">
              <div>
                <h3>Ask Atlaix AI <small>Beta</small></h3>
                <p>Get instant insights on {tokenSymbol}.</p>
              </div>
            </div>
            <div className="detection-ask-ai-prompts">
              {aiQuestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openAssistant(question);
                  }}
                >
                  {question}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
