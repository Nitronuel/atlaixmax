import { Activity, ArrowLeft, Bell, Copy, Scan, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DetectionTokenDetailResponse } from '../../shared/detection';
import { detectionEventSummaryForLabel } from '../../shared/detection-copy';
import { DetectionService } from './detection-service';

type LooseClassification = {
  primaryLabel?: string;
  displayLabel?: string;
};

const EVENT_ASSESSMENTS: Record<string, (tokenName: string) => string> = {
  BULLISH_CONTINUATION_PUMP: (tokenName) =>
    `${tokenName} is showing Bullish Continuation. Buyers remain in control after the recent move, and the trend looks healthier when volume and liquidity support the advance. Follow-through depends on price holding above recent support.`,
  BULLISH_CONTINUATION: (tokenName) =>
    `${tokenName} is showing Bullish Continuation. Buyers remain in control after the recent move, and the trend looks healthier when volume and liquidity support the advance. Follow-through depends on price holding above recent support.`,
  BEARISH_CONTINUATION_DUMP: (tokenName) =>
    `${tokenName} is showing Bearish Continuation. Sellers remain in control after the recent move, and the trend stays weak while sell pressure and bearish structure persist. Buyers need stronger volume to challenge the downtrend.`,
  BEARISH_CONTINUATION: (tokenName) =>
    `${tokenName} is showing Bearish Continuation. Sellers remain in control after the recent move, and the trend stays weak while sell pressure and bearish structure persist. Buyers need stronger volume to challenge the downtrend.`,
  BEARISH_RELIEF_BOUNCE: (tokenName) =>
    `${tokenName} is showing a Short-Term Bounce in a Bearish Trend. Price is bouncing after weakness, but the broader read still favors sellers. The bounce needs stronger volume and follow-through before it can be treated as a cleaner recovery.`,
  SHORT_TERM_BOUNCE_IN_BEARISH_TREND: (tokenName) =>
    `${tokenName} is showing a Short-Term Bounce in a Bearish Trend. Price is bouncing after weakness, but the broader read still favors sellers. The bounce needs stronger volume and follow-through before it can be treated as a cleaner recovery.`,
  BULLISH_PULLBACK: (tokenName) =>
    `${tokenName} is showing a Pullback in a Bullish Trend. Price is cooling off inside a broader bullish setup. The pullback stays healthier if buyers defend support and liquidity does not weaken.`,
  PULLBACK_IN_BULLISH_TREND: (tokenName) =>
    `${tokenName} is showing a Pullback in a Bullish Trend. Price is cooling off inside a broader bullish setup. The pullback stays healthier if buyers defend support and liquidity does not weaken.`,
  BEARISH_REVERSAL_ATTEMPT: (tokenName) =>
    `${tokenName} is showing a Possible Bullish Reversal Attempt. Buyers are trying to turn a weak trend upward after recent selling. The recovery needs volume follow-through and stronger structure before the reversal read becomes cleaner.`,
  POSSIBLE_BULLISH_REVERSAL_ATTEMPT: (tokenName) =>
    `${tokenName} is showing a Possible Bullish Reversal Attempt. Buyers are trying to turn a weak trend upward after recent selling. The recovery needs volume follow-through and stronger structure before the reversal read becomes cleaner.`,
  BULLISH_BREAKDOWN_ATTEMPT: (tokenName) =>
    `${tokenName} is showing a Possible Bearish Breakdown Attempt. Sellers are trying to break a stronger setup lower. Buyers need to reclaim the failed level quickly to weaken the breakdown read.`,
  POSSIBLE_BEARISH_BREAKDOWN_ATTEMPT: (tokenName) =>
    `${tokenName} is showing a Possible Bearish Breakdown Attempt. Sellers are trying to break a stronger setup lower. Buyers need to reclaim the failed level quickly to weaken the breakdown read.`,
  RANGE_BREAKOUT_ATTEMPT: (tokenName) =>
    `${tokenName} is attempting a range breakout. Price is trying to move above previous range highs, and the setup gets stronger if volume expansion or buy dominance supports the move. The breakout needs follow-through above the range to become cleaner.`,
  RANGE_BREAKDOWN_ATTEMPT: (tokenName) =>
    `${tokenName} is attempting a range breakdown. Price is trying to move below previous range lows, and the risk increases if sell dominance or liquidity drain appears nearby. Buyers need to reclaim the range to weaken the breakdown read.`,
  LOW_LIQUIDITY_PRICE_SPIKE: (tokenName) =>
    `${tokenName} is showing a low-liquidity price spike. Price moved up while liquidity was thin, so the move may be easier to reverse. This needs liquidity support before it can be treated as a cleaner bullish move.`,
  LOW_LIQUIDITY_SELL_OFF: (tokenName) =>
    `${tokenName} is showing a low-liquidity sell-off. Price dropped while liquidity was thin, which can make exits unstable. Risk grows if liquidity keeps falling or sell dominance remains active.`,
  LIQUIDITY_DRAIN: (tokenName) =>
    `${tokenName} is showing Liquidity Drain. Liquidity is leaving the pool, which makes price movement less stable and raises slippage risk. This becomes more dangerous when paired with sell dominance or high volatility.`,
  LIQUIDITY_ADDED: (tokenName) =>
    `${tokenName} is showing Liquidity Added. New liquidity entered the pool, improving trading depth and making price movement cleaner. This supports bullish continuation when paired with buy dominance or recent accumulation.`,
  PUMP: (tokenName) =>
    `${tokenName} is showing a Pump. Price is moving up fast with strong short-term activity. The move needs liquidity and volume support before it becomes a cleaner bullish read.`,
  DUMP: (tokenName) =>
    `${tokenName} is showing a Dump. Price is falling fast with strong short-term selling. Risk grows if liquidity weakens or sell pressure keeps expanding.`,
  BUY_RECOVERY: (tokenName) =>
    `${tokenName} is showing Buy Recovery. Buyers are returning after recent weakness, which suggests renewed demand. This becomes more meaningful if liquidity holds and sell pressure fades.`,
  SELL_OFF: (tokenName) =>
    `${tokenName} is showing Sell-Off. Sellers are pressing price lower, and the move becomes more serious if liquidity thins or higher-timeframe structure turns bearish.`,
  ACCUMULATION: (tokenName) =>
    `${tokenName} is showing Accumulation. Buyers are absorbing supply, and recent buy dominance suggests demand is building before a larger move. This read gets stronger if liquidity stays stable and volume continues expanding.`,
  DISTRIBUTION: (tokenName) =>
    `${tokenName} is showing Distribution. Sellers are becoming more active, and recent sell dominance suggests supply is being pushed into the market. The bearish read strengthens if price keeps failing to reclaim its recent range.`,
  CONSOLIDATION: (tokenName) =>
    `${tokenName} is showing Consolidation. Price is moving inside a tighter range while the market waits for stronger direction. The next read gets clearer when volume, liquidity, or flow breaks out of that range.`,
  LOW_ACTIVITY: (tokenName) =>
    `${tokenName} is showing Low Activity. Trading activity is quiet, so Atlaix has limited confirmation for a stronger market read. Watch for volume, flow, or liquidity changes before treating the signal as meaningful.`,
  INSUFFICIENT_DATA: (tokenName) =>
    `${tokenName} does not have enough reliable detection data yet. Atlaix needs more trading history before it can produce a stronger market read.`,
  UNKNOWN: (tokenName) =>
    `${tokenName}'s latest scan did not produce a clean directional event. Watch for a clearer event before treating this as a stronger market read.`
};

function formatUsd(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '$0';
  if (numberValue >= 1_000_000_000) return `$${(numberValue / 1_000_000_000).toFixed(2)}B`;
  if (numberValue >= 1_000_000) return `$${(numberValue / 1_000_000).toFixed(2)}M`;
  if (numberValue >= 1_000) return `$${(numberValue / 1_000).toFixed(1)}K`;
  return `$${numberValue.toFixed(0)}`;
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

function normalizeEventKey(value = '') {
  return value.trim().replace(/[-\s]+/g, '_').toUpperCase();
}

function assessmentFor(value = '') {
  return EVENT_ASSESSMENTS[normalizeEventKey(value)] || EVENT_ASSESSMENTS.UNKNOWN;
}

export function DetectionTokenPage() {
  const { chain = '', address = '' } = useParams();
  const [searchParams] = useSearchParams();
  const pair = searchParams.get('pair') || '';
  const [detail, setDetail] = useState<DetectionTokenDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    DetectionService.getToken(chain, address, pair)
      .then(setDetail)
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Detection token details are unavailable.'))
      .finally(() => setLoading(false));
  }, [address, chain, pair]);

  const classification = asClassification(detail?.latestClassification);
  const token = detail?.token;
  const tokenSymbol = token?.tokenSymbol || token?.tokenName || 'Unknown';
  const tokenName = token?.tokenName && token?.tokenSymbol && token.tokenName !== token.tokenSymbol ? token.tokenName : tokenSymbol;
  const chainDex = [token?.chain, token?.dexId].filter(Boolean).join(' / ');
  const assessmentEvent = detail?.events[0]?.eventType || classification?.displayLabel || humanizeLabel(classification?.primaryLabel || '') || 'No primary event';
  const assessmentCopy = assessmentFor(assessmentEvent)(tokenName);

  function copyValue(value?: string | null) {
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value);
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
            <span className="detection-token-kicker"><ShieldCheck size={16} />Detection Profile</span>
            <h2>{tokenName} <small>({tokenSymbol})</small></h2>
            {chainDex ? <p className="detection-token-network">{chainDex}</p> : null}
            <div className="detection-token-meta-row">
              <button type="button" onClick={() => copyValue(token.tokenAddress)} aria-label="Copy token address">
                {shortAddress(token.tokenAddress)} <Copy size={14} />
              </button>
              {token.pairAddress ? (
                <button type="button" onClick={() => copyValue(token.pairAddress)} aria-label="Copy pair address">
                  Pair {shortAddress(token.pairAddress)} <Copy size={14} />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="detection-assessment-row">
        <section className="detection-detail-panel detection-assessment-panel">
          <div className="detection-assessment-head">
            <span>Atlaix Assessment</span>
            <strong>{assessmentEvent}</strong>
          </div>
          <p className="detection-assessment-copy">{assessmentCopy}</p>
        </section>
        <nav className="detection-token-actions token-quick-actions-panel" aria-label="Token detection actions">
          <h3>Quick Actions</h3>
          <Link className="token-quick-action-button" to={`/token/${encodeURIComponent(token.tokenAddress)}?chain=${encodeURIComponent(token.chain)}&pair=${encodeURIComponent(token.pairAddress)}`}>
            <span className="token-quick-action-icon"><Activity size={18} /></span>
            <span><strong>Token Details</strong><small>Market profile</small></span>
          </Link>
          <Link className="token-quick-action-button" to="/safe-scan">
            <span className="token-quick-action-icon"><Scan size={18} /></span>
            <span><strong>Safe Scan</strong><small>Identify threats</small></span>
          </Link>
          <Link className="token-quick-action-button" to={`/smart-alerts?chain=${encodeURIComponent(token.chain)}&address=${encodeURIComponent(token.tokenAddress)}`}>
            <span className="token-quick-action-icon"><Bell size={18} /></span>
            <span><strong>Set Alert</strong><small>Smart alerts</small></span>
          </Link>
        </nav>
      </div>

      <section className="detection-detail-panel detection-timeline-panel">
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
                <p>{detectionEventSummaryForLabel(event.eventType, event.summary)}</p>
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
    </section>
  );
}
