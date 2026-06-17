import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, TrendingUp, Zap } from 'lucide-react';
import type { OverviewToken } from '../../shared/overview';
import { formatInteger, formatUsd, openToken } from './overview-utils';

type ChainVolume = {
  chain: string;
  volume: number;
};

type ChainMomentum = ChainVolume & {
  change: number;
};

type DefiLlamaDexOverview = {
  allChains?: string[];
  total24h?: number;
  change_1d?: number;
};

const DEFILLAMA_DEX_OVERVIEW_URL = 'https://api.llama.fi/overview/dexs';
const DEFILLAMA_CHAIN_VOLUME_LIMIT = 6;
const DEFILLAMA_MOMENTUM_MIN_VOLUME = 1_000_000;
const SUPPORTED_DEX_CHAINS = ['Ethereum', 'Solana', 'Base', 'BSC'] as const;
const SUPPORTED_CHAIN_LABELS = new Set<string>(SUPPORTED_DEX_CHAINS);

function compact(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return formatInteger(value);
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  const precision = Math.abs(value) >= 10 ? 0 : 1;
  return `${value > 0 ? '+' : ''}${value.toFixed(precision)}%`;
}

function formatChainLabel(chain: string) {
  const normalized = chain.trim().toLowerCase();
  if (normalized === 'bsc' || normalized === 'bnb') return 'BSC';
  if (normalized === 'eth') return 'Ethereum';
  if (normalized === 'sol') return 'Solana';
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : 'Unknown';
}

async function fetchDefiLlamaJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
  if (!response.ok) throw new Error(`DefiLlama request failed with status ${response.status}.`);
  return response.json() as Promise<T>;
}

async function fetchDefiLlamaChainVolumes(signal: AbortSignal): Promise<ChainVolume[]> {
  const settled = await Promise.allSettled(SUPPORTED_DEX_CHAINS.map(async (chain) => {
    const chainOverview = await fetchDefiLlamaJson<DefiLlamaDexOverview>(
      `${DEFILLAMA_DEX_OVERVIEW_URL}/${encodeURIComponent(chain)}`,
      signal
    );
    return { chain: formatChainLabel(chain), volume: Number(chainOverview.total24h || 0) };
  }));

  return settled
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .filter((item) => item.volume > 0)
    .sort((left, right) => right.volume - left.volume)
    .slice(0, DEFILLAMA_CHAIN_VOLUME_LIMIT);
}

async function fetchDefiLlamaChainMomentum(signal: AbortSignal): Promise<ChainMomentum | null> {
  const settled = await Promise.allSettled(SUPPORTED_DEX_CHAINS.map(async (chain) => {
    const chainOverview = await fetchDefiLlamaJson<DefiLlamaDexOverview>(
      `${DEFILLAMA_DEX_OVERVIEW_URL}/${encodeURIComponent(chain)}`,
      signal
    );
    return {
      chain: formatChainLabel(chain),
      volume: Number(chainOverview.total24h || 0),
      change: Number(chainOverview.change_1d || 0)
    };
  }));

  return settled
    .flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    .filter((item) => item.volume >= DEFILLAMA_MOMENTUM_MIN_VOLUME && Number.isFinite(item.change) && item.change !== 0)
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change))[0] || null;
}

export function MarketPulse({ tokens }: { tokens: OverviewToken[] }) {
  const [chainVolumeSlide, setChainVolumeSlide] = useState(0);
  const [defiLlamaChainVolumes, setDefiLlamaChainVolumes] = useState<ChainVolume[]>([]);
  const [defiLlamaChainMomentum, setDefiLlamaChainMomentum] = useState<ChainMomentum | null>(null);
  const [smartRotationStatus, setSmartRotationStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const positive = tokens.filter((token) => Number(token.change24h) > 0).length;
  const sentimentScore = tokens.length ? Math.round((positive / tokens.length) * 100) : 50;
  const sentimentLabel = sentimentScore >= 65 ? 'Bullish' : sentimentScore <= 35 ? 'Bearish' : 'Neutral';
  const localChainVolumes = useMemo(() => {
    const chainVolumes = new Map<string, number>();
    tokens.forEach((token) => {
      const chain = formatChainLabel(token.chain);
      chainVolumes.set(chain, (chainVolumes.get(chain) || 0) + token.volume24hUsd);
    });
    return [...chainVolumes.entries()]
      .map(([chain, volume]) => ({ chain, volume }))
      .filter((item) => item.volume > 0 && SUPPORTED_CHAIN_LABELS.has(item.chain))
      .sort((left, right) => right.volume - left.volume)
      .slice(0, DEFILLAMA_CHAIN_VOLUME_LIMIT);
  }, [tokens]);
  const displayedChainVolumes = defiLlamaChainVolumes.length ? defiLlamaChainVolumes : localChainVolumes;
  const topInflow = [...tokens].sort((left, right) => right.dexFlowUsd24h - left.dexFlowUsd24h)[0] || null;
  const totalVolume = displayedChainVolumes.reduce((sum, item) => sum + item.volume, 0);
  const chainVolumeSlideCount = Math.max(1, displayedChainVolumes.length);
  const visibleChainVolumePair = useMemo(() => {
    if (!displayedChainVolumes.length) return [];
    const current = displayedChainVolumes[chainVolumeSlide % displayedChainVolumes.length];
    const next = displayedChainVolumes.length > 1 ? displayedChainVolumes[(chainVolumeSlide + 1) % displayedChainVolumes.length] : null;
    return next ? [current, next] : [current];
  }, [chainVolumeSlide, displayedChainVolumes]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void Promise.all([
      fetchDefiLlamaChainVolumes(controller.signal),
      fetchDefiLlamaChainMomentum(controller.signal)
    ])
      .then(([volumes, momentum]) => {
        if (!active) return;
        setDefiLlamaChainVolumes(volumes);
        setDefiLlamaChainMomentum(momentum);
        setSmartRotationStatus(momentum ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!active) return;
        setDefiLlamaChainVolumes([]);
        setDefiLlamaChainMomentum(null);
        setSmartRotationStatus('error');
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

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
        <div className="overview-pulse-card overview-pulse-card--rotation">
          <div className="overview-pulse-main">
            <span><Zap size={16} /> Smart Rotation</span>
            <strong>{defiLlamaChainMomentum?.chain || (smartRotationStatus === 'loading' ? 'Scanning' : 'No rotation')}</strong>
          </div>
          <small>
            {defiLlamaChainMomentum
              ? `${formatPercent(defiLlamaChainMomentum.change)} volume ${defiLlamaChainMomentum.change > 0 ? 'increase' : 'decrease'}`
              : smartRotationStatus === 'loading' ? 'Checking supported chains'
                : smartRotationStatus === 'empty' ? 'No volume change'
                  : 'DefiLlama unavailable'}
          </small>
        </div>
        <button className="overview-pulse-card overview-pulse-card--inflow as-button" type="button" onClick={() => topInflow && openToken(topInflow)} disabled={!topInflow}>
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
