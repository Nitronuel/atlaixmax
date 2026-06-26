import { Activity, Boxes, CircleDot, Copy, Lock, Percent, Shield, ShieldAlert, Users, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { ClusterData, TokenDetails, TokenHolder, TokenMetrics } from '../../shared/bubblemaps';
import type { LiquidityLockReport, SecurityFlag, SecurityScannerReport } from '../../shared/security-scanner';
import { formatCompact, formatCurrencyCompact, formatNumber, formatPercent, formatPercentPoints, shortenAddress } from './format';
import { clusterSupplyBalance, clusterSupplyPercent, holderSupplyPercent } from './safe-scan-data';
import type { LiveTokenLiquidity } from './safe-scan-service';
import { Card, EmptyBlock, SectionHeader, type LabelMap } from './ui';
import { WalletTable } from './WalletTable';

function asPercent(value: unknown) {
  return formatPercent(typeof value === 'number' && value <= 1 ? value * 100 : value);
}

function asClusterPercent(value: unknown) {
  return formatPercentPoints(value);
}

function formatTokenAge(value?: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days >= 365) return `${formatNumber(Math.floor(days / 365))}y`;
  if (days >= 1) return `${formatNumber(days)}d`;
  return 'New';
}

function scoreTone(score: number | undefined) {
  if (!Number.isFinite(score)) return '';
  if (Number(score) >= 70) return 'safe';
  if (Number(score) < 40) return 'danger';
  return '';
}

function IntelligenceRow({ icon, label, value, detail, tone = '' }: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="safe-scan-intelligence-row">
      <span className="safe-scan-intelligence-copy">
        <span className="safe-scan-intelligence-icon">{icon}</span>
        <span>
          <span>{label}</span>
          {detail ? <small>{detail}</small> : null}
        </span>
      </span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export function ScorePanel({ metrics }: { metrics: TokenMetrics | null }) {
  if (!metrics) {
    return (
      <Card className="safe-scan-intelligence-card decentralization">
        <h3>Decentralization Scores</h3>
        <EmptyBlock title="Metrics unavailable" body="Bubblemaps did not return score data for this token." />
      </Card>
    );
  }

  return (
    <Card className="safe-scan-intelligence-card decentralization">
      <h3>Decentralization Scores</h3>
      <div className="safe-scan-intelligence-list">
        <IntelligenceRow icon={<ShieldAlert size={16} />} label="Score" value={formatNumber(metrics.scores.bubblemaps_score)} detail="Distribution score" tone={scoreTone(metrics.scores.bubblemaps_score)} />
        <IntelligenceRow icon={<Activity size={16} />} label="Gini index" value={formatNumber(metrics.scores.gini_index)} detail="Holder inequality" />
        <IntelligenceRow icon={<Percent size={16} />} label="HHI" value={formatNumber(metrics.scores.herfindahl_hirschman_index)} detail="Concentration index" />
        <IntelligenceRow icon={<Users size={16} />} label="Nakamoto" value={formatNumber(metrics.scores.nakamoto_coefficient)} detail="Entities needed for 50%" />
      </div>
    </Card>
  );
}

export function SupplyExposurePanel({ metrics, topHolder, largestCluster, totalSupply }: {
  metrics: TokenMetrics | null;
  topHolder?: TokenHolder | null;
  largestCluster?: ClusterData | null;
  totalSupply?: number | null;
}) {
  const stats = metrics?.supply_stats;

  return (
    <Card className="safe-scan-intelligence-card supply">
      <h3>Supply Exposure</h3>
      {!stats ? <EmptyBlock title="Supply stats unavailable" body="No Bubblemaps supply stats were returned." /> : null}
      {stats ? (
        <div className="safe-scan-intelligence-list">
          <IntelligenceRow icon={<Wallet size={16} />} label="CEX wallets" value={asPercent(stats.cexs)} detail="Centralized exchange share" />
          <IntelligenceRow icon={<Activity size={16} />} label="DEX wallets" value={asPercent(stats.dexs)} detail="Liquidity venue share" />
          <IntelligenceRow icon={<Boxes size={16} />} label="Contracts" value={asPercent(stats.contracts)} detail="Contract-held supply" />
          <IntelligenceRow icon={<CircleDot size={16} />} label="Fresh wallets" value={asPercent(stats.fresh_wallets)} detail="New wallet exposure" />
          <IntelligenceRow icon={<Users size={16} />} label="Top 10 adjusted" value={asPercent(stats.top_10_adjusted)} detail="Top holders after adjustments" />
          <IntelligenceRow icon={<Boxes size={16} />} label="Bundles" value={asPercent(stats.bundles)} detail="Bundled holder share" />
          <IntelligenceRow icon={<Wallet size={16} />} label="Largest holder" value={topHolder ? asClusterPercent(holderSupplyPercent(topHolder, totalSupply || null)) : 'N/A'} detail={topHolder ? shortenAddress(topHolder.address) : 'No holders returned'} />
          <IntelligenceRow icon={<CircleDot size={16} />} label="Largest cluster" value={largestCluster ? asClusterPercent(clusterSupplyPercent(largestCluster, totalSupply || null)) : 'N/A'} detail={largestCluster ? `${formatNumber(largestCluster.holder_count)} linked holders` : 'No clusters returned'} />
        </div>
      ) : null}
    </Card>
  );
}

function SafetyMetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="safe-scan-safety-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function TokenSafetyReportPanel({ token, address, chainLabel, clusters, totalSupply }: {
  token: TokenDetails | null;
  address: string;
  chainLabel: string;
  clusters: ClusterData[];
  totalSupply?: number | null;
}) {
  const clusterBalance = clusterSupplyBalance(clusters);
  const clusterShare = clusters.reduce((sum, cluster) => sum + Number(clusterSupplyPercent(cluster, totalSupply || null) || 0), 0);

  return (
    <Card className="safe-scan-token-report-card">
      <div className="safe-scan-token-report">
        <div className="token-heading compact">
          <div className="token-logo">{token?.metadata.img_url ? <img src={token.metadata.img_url} alt="" /> : (token?.metadata.symbol || 'BM').slice(0, 2)}</div>
          <div>
            <h2>{token?.metadata.name || 'Token Safety Report'}</h2>
            <div className="token-meta">
              <span>{token?.metadata.symbol || 'N/A'}</span>
              <span>{chainLabel}</span>
              <button type="button" onClick={() => navigator.clipboard?.writeText(address)} aria-label="Copy token address">
                {shortenAddress(address)} <Copy size={14} />
              </button>
            </div>
          </div>
        </div>
        <div className="safe-scan-token-report-mini">
          <SafetyMetricCard label="Token age" value={formatTokenAge(token?.stats?.min_date)} />
          <SafetyMetricCard
            label="Cluster supply"
            value={asClusterPercent(clusterShare)}
            detail={`${formatCompact(clusterBalance)} tokens`}
          />
        </div>
      </div>
    </Card>
  );
}

function drainRiskTone(value: number | null) {
  if (value === null) return 'unknown';
  if (value >= 100) return 'danger';
  if (value >= 50) return 'warning';
  return 'safe';
}

function drainRiskLabel(value: number | null) {
  if (value === null) return 'Liquidity unavailable';
  if (value >= 100) return 'Cluster supply can exceed live liquidity';
  if (value >= 50) return 'High liquidity pressure';
  return 'Below live liquidity';
}

function liquidityLockMessage(lockReport: LiquidityLockReport | null | undefined, loading?: boolean, error?: string | null) {
  if (loading) return 'Checking liquidity pool lock status...';
  if (error || !lockReport) return null;
  if (lockReport.status === 'unknown' || lockReport.status === 'unsupported') return null;
  if (lockReport.message.toLowerCase().includes('goplus')) return null;
  if (lockReport.message === 'N/A') return null;
  return lockReport.message;
}

function liquidityLockTone(lockReport: LiquidityLockReport | null | undefined) {
  if (lockReport?.status === 'locked') return 'safe';
  if (lockReport?.status === 'unlocked') return 'danger';
  return 'unknown';
}

export function LiquidityPoolLockPanel({ clusters, totalSupply, liquidity, lockReport, lockLoading, lockError, loading, error }: {
  clusters: ClusterData[];
  totalSupply?: number | null;
  liquidity?: LiveTokenLiquidity | null;
  lockReport?: LiquidityLockReport | null;
  lockLoading?: boolean;
  lockError?: string | null;
  loading?: boolean;
  error?: string | null;
}) {
  const clusterBalance = clusterSupplyBalance(clusters);
  const clusterShare = clusterBalance !== null && totalSupply ? (clusterBalance / totalSupply) * 100 : null;
  const clusterValueUsd = clusterBalance !== null && liquidity?.tokenPriceUsd ? clusterBalance * liquidity.tokenPriceUsd : null;
  const liquidityShare = clusterBalance !== null && liquidity?.tokenLiquidity ? (clusterBalance / liquidity.tokenLiquidity) * 100 : null;
  const tone = drainRiskTone(liquidityShare);
  const lockTone = liquidityLockTone(lockReport);
  const lockedValue = lockReport?.lockedUsd !== null && lockReport?.lockedUsd !== undefined
    ? lockReport.lockedUsd
    : lockReport?.lockedPercent !== null && lockReport?.lockedPercent !== undefined && liquidity
      ? liquidity.liquidityUsd * (lockReport.lockedPercent / 100)
      : null;
  const lockMessage = liquidityLockMessage(lockReport, lockLoading, lockError);

  return (
    <div className="safe-scan-liquidity-stack">
      <Card className={`safe-scan-liquidity-lock-card ${lockTone}`}>
        <div className="safe-scan-lock-heading">
          <Lock size={17} />
          <span>Liquidity Pool Lock</span>
        </div>
        {lockMessage ? <p>{lockMessage}</p> : null}
        <div className="safe-scan-lock-grid">
          <div>
            <span>Locked LP</span>
            <strong>{lockReport?.lockedPercent !== null && lockReport?.lockedPercent !== undefined ? formatPercent(lockReport.lockedPercent) : 'N/A'}</strong>
          </div>
          <div>
            <span>Locked value</span>
            <strong>{lockedValue !== null ? formatCurrencyCompact(lockedValue) : 'N/A'}</strong>
          </div>
        </div>
      </Card>
      <Card className={`safe-scan-drain-card ${tone}`}>
        <div className="safe-scan-drain-head">
          <span>Drain Risk</span>
          <strong>{drainRiskLabel(liquidityShare)}</strong>
        </div>
        <div className="safe-scan-drain-grid">
          <div>
            <span>Cluster held supply</span>
            <strong>{clusterValueUsd !== null ? formatCurrencyCompact(clusterValueUsd) : `${formatCompact(clusterBalance)} tokens`}</strong>
            <small>{clusterShare !== null ? `${formatPercent(clusterShare)} of supply` : 'N/A of supply'}</small>
          </div>
          <div>
            <span>Live liquidity</span>
            <strong>{liquidity ? formatCurrencyCompact(liquidity.liquidityUsd) : 'N/A'}</strong>
          </div>
          <div>
            <span>Liquidity held</span>
            <strong>{liquidityShare !== null ? formatPercent(liquidityShare) : 'N/A'}</strong>
          </div>
        </div>
        {loading || error || !liquidity ? <p>{error || (loading ? 'Checking live pool depth...' : 'No live token-side liquidity was found for this token.')}</p> : null}
      </Card>
    </div>
  );
}

function SecurityStatusPill({ state, children }: { state: 'safe' | 'risk' | 'unknown'; children: ReactNode }) {
  return <span className={`safe-scan-security-pill ${state}`}>{children}</span>;
}

const fallbackSecurityFlags: SecurityFlag[] = [
    { label: 'Honeypot', value: 'Unknown', state: 'unknown' },
    { label: 'Renounced', value: 'Unknown', state: 'unknown' },
    { label: 'Mintable', value: 'Unknown', state: 'unknown' },
    { label: 'Freezable', value: 'Unknown', state: 'unknown' },
    { label: 'Drainable', value: 'Unknown', state: 'unknown' },
    { label: 'Pausable', value: 'Unknown', state: 'unknown' },
    { label: 'Verified', value: 'Unknown', state: 'unknown' },
    { label: 'Proxy contract', value: 'Unknown', state: 'unknown' },
    { label: 'Tax', value: 'Unknown', state: 'unknown' }
];

export function SecurityScannerPanel({ report }: {
  report?: SecurityScannerReport | null;
}) {
  const flags = report?.flags?.length ? report.flags : fallbackSecurityFlags;

  return (
    <Card className="safe-scan-security-card">
      <SectionHeader
        icon={<Shield size={20} />}
        title="Security Scanner"
        eyebrow="Contract checks"
      />
      <div className="safe-scan-security-grid">
        {flags.map((flag) => (
          <div className="safe-scan-security-flag" key={flag.label}>
            <span>{flag.label}</span>
            <SecurityStatusPill state={flag.state}>{flag.value}</SecurityStatusPill>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function HolderConcentrationPanel({ holders, labels, totalSupply }: {
  holders: TokenHolder[];
  labels: LabelMap;
  totalSupply?: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const holderCount = holders.length;
  const topTenShare = holders.slice(0, 10).reduce((sum, holder) => sum + Number(holderSupplyPercent(holder, totalSupply || null) || 0), 0);

  return (
    <Card>
      <SectionHeader
        icon={<Users size={20} />}
        title="Holder Concentration"
        eyebrow="Largest balances"
        action={holderCount ? (
          <button className="secondary-pill" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? 'Hide holders' : `Show holders (${formatNumber(holderCount)})`}
          </button>
        ) : null}
      />
      <div className="safe-scan-concentration-pulse">
        <div className="overview-pulse-card">
          <div className="overview-pulse-main">
            <span><Wallet size={16} /> Tracked holders</span>
            <strong>{formatNumber(holderCount)}</strong>
          </div>
        </div>
        <div className="overview-pulse-card">
          <div className="overview-pulse-main">
            <span><Percent size={16} /> Top 10 share</span>
            <strong>{asClusterPercent(topTenShare)}</strong>
          </div>
        </div>
        <div className="overview-pulse-card">
          <div className="overview-pulse-main">
            <span><Users size={16} /> Largest holder</span>
            <strong>{holders[0] ? asClusterPercent(holderSupplyPercent(holders[0], totalSupply || null)) : 'N/A'}</strong>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="stacked-tables">
          <WalletTable rows={holders} labels={labels} empty="No top holder details for this scan." maxRows={120} totalSupply={totalSupply} />
        </div>
      ) : null}
    </Card>
  );
}
