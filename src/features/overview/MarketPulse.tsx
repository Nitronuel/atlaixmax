import { useEffect, useMemo, useState } from 'react';
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

function formatChainLabel(chain: string) {
  const normalized = chain.trim().toLowerCase();
  if (normalized === 'bsc' || normalized === 'bnb') return 'BSC';
  if (normalized === 'eth') return 'Ethereum';
  if (normalized === 'sol') return 'Solana';
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
}

export function MarketPulse({ tokens }: { tokens: OverviewToken[] }) {
  const [chainVolumeSlide, setChainVolumeSlide] = useState(0);
  const positive = tokens.filter((token) => Number(token.change24h) > 0).length;
  const sentimentScore = tokens.length ? Math.round((positive / tokens.length) * 100) : 50;
  const sentimentLabel = sentimentScore >= 65 ? 'Bullish' : sentimentScore <= 35 ? 'Bearish' : 'Neutral';
  const chainVolumes = new Map<string, number>();
  tokens.forEach((token) => {
    const chain = formatChainLabel(token.chain);
    chainVolumes.set(chain, (chainVolumes.get(chain) || 0) + token.volume24hUsd);
  });
  const topChainVolumes = useMemo(() => [...chainVolumes.entries()]
    .map(([chain, volume]) => ({ chain, volume }))
    .filter((item) => item.volume > 0)
    .sort((left, right) => right.volume - left.volume)
    .slice(0, 6), [tokens]);
  const topChain = topChainVolumes[0] || null;
  const topInflow = [...tokens].sort((left, right) => right.dexFlowUsd24h - left.dexFlowUsd24h)[0] || null;
  const totalVolume = tokens.reduce((sum, token) => sum + token.volume24hUsd, 0);
  const chainVolumeSlideCount = Math.max(1, topChainVolumes.length);
  const visibleChainVolumePair = useMemo(() => {
    if (!topChainVolumes.length) return [];
    const current = topChainVolumes[chainVolumeSlide % topChainVolumes.length];
    const next = topChainVolumes.length > 1 ? topChainVolumes[(chainVolumeSlide + 1) % topChainVolumes.length] : null;
    return next ? [current, next] : [current];
  }, [chainVolumeSlide, topChainVolumes]);

  useEffect(() => {
    if (chainVolumeSlideCount <= 1) return undefined;
    const interval = window.setInterval(() => {
      setChainVolumeSlide((current) => (current + 1) % chainVolumeSlideCount);
    }, 3500);
    return () => window.clearInterval(interval);
  }, [chainVolumeSlideCount]);

  useEffect(() => {
    if (chainVolumeSlide >= chainVolumeSlideCount) setChainVolumeSlide(0);
  }, [chainVolumeSlide, chainVolumeSlideCount]);

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
            <strong>{topChain?.chain || 'Scanning'}</strong>
          </div>
          <small>{topChain ? `${formatUsd(topChain.volume)} volume` : 'Waiting for feed'}</small>
        </div>
        <button className="overview-pulse-card as-button" type="button" onClick={() => topInflow && openToken(topInflow)} disabled={!topInflow}>
          <div className="overview-pulse-main">
            <span><TrendingUp size={16} /> Top Inflow</span>
            <strong>{topInflow?.symbol || 'Scanning'}</strong>
          </div>
          <small>{topInflow ? `${topInflow.dexFlowUsd24h > 0 ? '+' : ''}${formatUsd(topInflow.dexFlowUsd24h)} flow` : 'Waiting for feed'}</small>
        </button>
        <div className="overview-pulse-card overview-volume-card">
          <div className="overview-pulse-main">
            <span><BarChart3 size={16} /> 24h DEX Volume</span>
            <div key={chainVolumeSlide} className="overview-volume-carousel" aria-label={`Total 24h DEX volume ${formatUsd(totalVolume)}`}>
              <strong>{visibleChainVolumePair[0]?.chain || 'Scanning'}</strong>
              <b>{visibleChainVolumePair[0] ? `$${compact(visibleChainVolumePair[0].volume)}` : '$0'}</b>
              {visibleChainVolumePair[1] ? (
                <span>
                  <em>{visibleChainVolumePair[1].chain}</em>
                  <i>${compact(visibleChainVolumePair[1].volume)}</i>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
