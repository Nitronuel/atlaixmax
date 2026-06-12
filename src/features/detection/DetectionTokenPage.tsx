import { ArrowLeft, ExternalLink, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DetectionTokenDetailResponse } from '../../shared/detection';
import { DetectionService } from './detection-service';

type LooseClassification = {
  reason?: string;
  risk?: { reasons?: string[] };
  manipulationRisk?: { reasons?: string[] };
  evidence?: string[];
  warnings?: string[];
  dataQuality?: { score?: number; warnings?: string[] };
};

function formatUsd(value: unknown) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '$0';
  if (numberValue >= 1_000_000_000) return `$${(numberValue / 1_000_000_000).toFixed(2)}B`;
  if (numberValue >= 1_000_000) return `$${(numberValue / 1_000_000).toFixed(2)}M`;
  if (numberValue >= 1_000) return `$${(numberValue / 1_000).toFixed(1)}K`;
  return `$${numberValue.toFixed(0)}`;
}

function formatPercent(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '0.00%';
  return `${numberValue > 0 ? '+' : ''}${numberValue.toFixed(2)}%`;
}

function asClassification(value: unknown): LooseClassification | null {
  return value as LooseClassification | null;
}

function importantRiskReasons(classification: LooseClassification | null) {
  return [
    ...(classification?.risk?.reasons || []),
    ...(classification?.manipulationRisk?.reasons || [])
  ].filter((reason) => reason && reason !== 'No major risk driver detected.').slice(0, 4);
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

  const classification = useMemo(() => asClassification(detail?.latestClassification || null), [detail]);
  const snapshot = (detail?.latestSnapshot || {}) as Record<string, unknown>;
  const token = detail?.token;
  const riskReasons = importantRiskReasons(classification);

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
        <div>
          <span className="detection-token-kicker"><ShieldCheck size={16} />Detection Profile</span>
          <h2>{token.tokenSymbol || token.tokenName || 'Unknown token'}</h2>
          <p>{classification?.reason || 'The engine has not produced a detailed verdict for this token yet.'}</p>
        </div>
      </header>

      <div className="detection-token-actions">
        <Link to={`/token/${encodeURIComponent(token.tokenAddress)}?chain=${encodeURIComponent(token.chain)}&pair=${encodeURIComponent(token.pairAddress)}`}>Token Details</Link>
        <Link to="/safe-scan">Safe Scan</Link>
        {token.pairUrl ? <a href={token.pairUrl} target="_blank" rel="noreferrer">DexScreener <ExternalLink size={15} /></a> : null}
      </div>

      <section className="detection-token-metrics">
        <div><span>24h Volume</span><strong>{formatUsd((snapshot as { volume24h?: unknown }).volume24h)}</strong></div>
        <div><span>Liquidity</span><strong>{formatUsd((snapshot as { liquidityUsd?: unknown }).liquidityUsd)}</strong></div>
        <div><span>Market Cap</span><strong>{formatUsd((snapshot as { marketCap?: unknown }).marketCap)}</strong></div>
        <div><span>24h Change</span><strong>{formatPercent((snapshot as { priceChange24h?: unknown }).priceChange24h)}</strong></div>
      </section>

      <div className="detection-token-grid">
        <article className="detection-detail-panel">
          <h3>Evidence</h3>
          {(classification?.evidence || []).length ? (
            <ul>{classification?.evidence?.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>No evidence rows were stored for this classification.</p>}
        </article>

        <article className="detection-detail-panel">
          <h3>Warnings</h3>
          {([...classification?.warnings || [], ...classification?.dataQuality?.warnings || []]).length ? (
            <ul>{[...classification?.warnings || [], ...classification?.dataQuality?.warnings || []].map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>No warnings were attached to the latest classification.</p>}
        </article>

        <article className="detection-detail-panel">
          <h3>Risk Reasons</h3>
          {riskReasons.length ? (
            <ul>{riskReasons.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : <p>No major risk driver was detected in the latest classification.</p>}
        </article>
      </div>

      <section className="detection-detail-panel detection-timeline-panel">
        <h3>Event Timeline</h3>
        {detail.events.length ? (
          <div className="detection-token-timeline">
            {detail.events.map((event) => (
              <div key={event.id}>
                <span className={`detection-sentiment sentiment-${event.sentiment}`}>{event.sentiment.toUpperCase()}</span>
                <strong>{event.eventType}</strong>
                <p>{event.summary}</p>
              </div>
            ))}
          </div>
        ) : <p>No event timeline exists for this token yet.</p>}
      </section>
    </section>
  );
}
