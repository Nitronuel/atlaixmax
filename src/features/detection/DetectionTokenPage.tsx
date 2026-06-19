import { Activity, ArrowLeft, Bell, Copy, Scan, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DetectionTokenAiAssessmentResponse, DetectionTokenDetailResponse } from '../../shared/detection';
import { detectionEventAssessmentForLabel } from '../../shared/detection-copy';
import { DetectionService } from './detection-service';

type LooseClassification = {
  primaryLabel?: string;
  displayLabel?: string;
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

function relationshipLabel(value = '') {
  return humanizeLabel(value).replace('Sequential ', '');
}

export function DetectionTokenPage() {
  const { chain = '', address = '' } = useParams();
  const [searchParams] = useSearchParams();
  const pair = searchParams.get('pair') || '';
  const [detail, setDetail] = useState<DetectionTokenDetailResponse | null>(null);
  const [aiAssessment, setAiAssessment] = useState<DetectionTokenAiAssessmentResponse | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setAssessmentLoading(true);
    setError(null);
    setAiAssessment(null);
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
            <h2>{tokenName} <small>({tokenSymbol})</small></h2>
            {chainDex ? <p className="detection-token-network">{chainDex}</p> : null}
            <div className="detection-token-meta-row">
              <button type="button" onClick={() => copyValue(token.tokenAddress)} aria-label="Copy token address">
                {shortAddress(token.tokenAddress)} <Copy size={14} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="detection-assessment-row">
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
        <nav className="detection-token-actions token-quick-actions-panel" aria-label="Token detection actions">
          <h3>Quick Actions</h3>
          <Link className="token-quick-action-button" to={`/token/${encodeURIComponent(token.tokenAddress)}?chain=${encodeURIComponent(token.chain)}&pair=${encodeURIComponent(token.pairAddress)}`}>
            <span className="token-quick-action-icon"><Activity size={18} /></span>
            <span><strong>Token Details</strong><small>Market data</small></span>
          </Link>
          <Link className="token-quick-action-button" to={`/smart-alerts?chain=${encodeURIComponent(token.chain)}&address=${encodeURIComponent(token.tokenAddress)}`}>
            <span className="token-quick-action-icon"><Bell size={18} /></span>
            <span><strong>Set Alert</strong><small>Smart alerts</small></span>
          </Link>
          <Link className="token-quick-action-button" to="/safe-scan">
            <span className="token-quick-action-icon"><Scan size={18} /></span>
            <span><strong>Safe Scan</strong><small>Risk check</small></span>
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
    </section>
  );
}
