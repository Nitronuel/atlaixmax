import { Activity, BarChart3, TrendingUp, Zap } from 'lucide-react';
import type { OverviewToken } from '../../shared/overview';
import { formatInteger, formatUsd, openToken } from './overview-utils';

function compact(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatInteger(value);
}

export function MarketPulse({ tokens }: { tokens: OverviewToken[] }) {
  const positive = tokens.filter((token) => Number(token.change24h) > 0).length;
  const sentimentScore = tokens.length ? Math.round((positive / tokens.length) * 100) : 50;
  const sentimentLabel = sentimentScore >= 65 ? 'Bullish' : sentimentScore <= 35 ? 'Bearish' : 'Neutral';
  const chainVolumes = new Map<string, number>();
  tokens.forEach((token) => chainVolumes.set(token.chain, (chainVolumes.get(token.chain) || 0) + token.volume24hUsd));
  const topChain = [...chainVolumes.entries()].sort((left, right) => right[1] - left[1])[0];
  const topInflow = [...tokens].sort((left, right) => right.dexFlowUsd24h - left.dexFlowUsd24h)[0] || null;
  const totalVolume = tokens.reduce((sum, token) => sum + token.volume24hUsd, 0);

  return (
    <section className="overview-pulse">
      <div className="overview-section-title">
        <h2>AI Market Pulse</h2>
        <span />
      </div>
      <div className="overview-pulse-grid">
        <div className="overview-pulse-card">
          <div className="overview-pulse-main">
            <span><Activity size={16} /> AI Sentiment</span>
            <strong>{sentimentLabel}</strong>
          </div>
        </div>
        <div className="overview-pulse-card">
          <div className="overview-pulse-main">
            <span><Zap size={16} /> Smart Rotation</span>
            <strong>{topChain?.[0] || 'Scanning'}</strong>
          </div>
          <small>{topChain ? `${formatUsd(topChain[1])} volume` : 'Waiting for feed'}</small>
        </div>
        <button className="overview-pulse-card as-button" type="button" onClick={() => topInflow && openToken(topInflow)} disabled={!topInflow}>
          <div className="overview-pulse-main">
            <span><TrendingUp size={16} /> Top Inflow</span>
            <strong>{topInflow?.symbol || 'Scanning'}</strong>
          </div>
          <small>{topInflow ? `${topInflow.dexFlowUsd24h > 0 ? '+' : ''}${formatUsd(topInflow.dexFlowUsd24h)} flow` : 'Waiting for feed'}</small>
        </button>
        <div className="overview-pulse-card">
          <div className="overview-pulse-main">
            <span><BarChart3 size={16} /> 24h DEX Volume</span>
            <strong>${compact(totalVolume)}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
