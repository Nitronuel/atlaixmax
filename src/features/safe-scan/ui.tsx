import type { ReactNode } from 'react';
import type { EndpointResult, LabelResponse } from '../../shared/insightx';

export type LabelMap = Map<string, LabelResponse>;

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function EmptyBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-block">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

export function SectionHeader({ icon, title, eyebrow, action }: { icon: ReactNode; title: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <div className="section-heading">
        <span className="section-icon">{icon}</span>
        <div>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h2>{title}</h2>
        </div>
      </div>
      {action ? <div className="section-action">{action}</div> : null}
    </div>
  );
}

function endpointTone(status?: EndpointResult['status']) {
  if (status === 'available') return 'good';
  if (status === 'unsupported' || status === 'missing' || status === 'not_configured') return 'warn';
  return 'bad';
}

export function StatusPill({ result, label }: { result?: EndpointResult; label?: string }) {
  return <span className={`status-pill ${endpointTone(result?.status)}`}>{label || result?.status?.replace('_', ' ') || 'missing'}</span>;
}

export function MetricCard({ label, value, detail, tone = '' }: { label: string; value: ReactNode; detail?: ReactNode; tone?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone}`}>{value}</div>
      {detail ? <div className="metric-detail">{detail}</div> : null}
    </div>
  );
}
