import { Loader2, Lock, Radar, ShieldAlert, Users, XCircle } from 'lucide-react';
import { useState } from 'react';
import type {
  BundlersResponse,
  DexMetrics,
  EndpointResult,
  InsidersResponse,
  ScannerResponse,
  SnipersResponse,
  WalletEntry
} from '../../shared/insightx';
import { formatCurrencyCompact, formatNumber, formatPercent, normalizePercentValue } from './format';
import type { LiveTokenLiquidity } from './safe-scan-service';
import { Card, EmptyBlock, MetricCard, SectionHeader, StatusPill, type LabelMap } from './ui';
import { WalletTable } from './WalletTable';

type AdvancedScannerData = Record<string, unknown> & {
  creator?: {
    address?: string;
    balance?: string | number;
  };
  top_holders?: WalletEntry[];
  locked_liquidity?: LiquidityLock[];
  liquidity_locks?: LiquidityLock[];
};

type LiquidityLock = {
  dex?: string;
  pair?: string;
  pair_address?: string;
  locker?: string;
  platform?: string;
  locks?: Array<{ percentage?: string | number; type?: string }>;
  total_locked?: string | number;
  locked?: string | number;
  locked_percent?: string | number;
  percentage?: string | number;
  usd?: string | number;
  value_usd?: string | number;
  lockedValue?: string | number;
};

function scannerAdvanced(scanner: ScannerResponse | null): AdvancedScannerData {
  const advanced = scanner?.results?.advanced;
  return advanced && typeof advanced === 'object' ? advanced as AdvancedScannerData : {};
}

function formatLockPercent(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return `${numeric.toFixed(numeric >= 10 ? 1 : 2)}%`;
}

function liquidityPoolRows(scanner: ScannerResponse | null) {
  const advanced = scannerAdvanced(scanner);
  const rows = [
    ...(Array.isArray(advanced.locked_liquidity) ? advanced.locked_liquidity : []),
    ...(Array.isArray(advanced.liquidity_locks) ? advanced.liquidity_locks : [])
  ].map((pool) => {
    const lock = Array.isArray(pool.locks) ? pool.locks.find((item) => Number(item?.percentage) > 0) : null;
    const lockedAmount =
      formatLockPercent(pool.total_locked) ||
      formatLockPercent(pool.locked_percent) ||
      formatLockPercent(pool.locked) ||
      formatLockPercent(pool.percentage) ||
      formatLockPercent(lock?.percentage);
    const poolName = String(pool.dex || pool.platform || pool.locker || 'Liquidity pool');
    const pair = String(pool.pair_address || pool.pair || '');
    return { poolName, pair, lockedAmount };
  }).filter((pool) => pool.lockedAmount);

  return rows.sort((left, right) => Number.parseFloat(right.lockedAmount) - Number.parseFloat(left.lockedAmount));
}

export function ScannerPanel({ scanner, result }: { scanner: ScannerResponse | null; result?: EndpointResult<ScannerResponse> }) {
  const advanced = scannerAdvanced(scanner);
  const scannerSources = [advanced, scanner?.results, scanner].filter(Boolean) as Array<Record<string, unknown>>;
  const flags = contractChecks(scannerSources);

  return (
    <Card>
      <div className="panel-title-row">
        <SectionHeader icon={<ShieldAlert size={20} />} title="Security Scanner" eyebrow="Contract checks" />
        <StatusPill result={result} />
      </div>
      {!scanner ? (
        <EmptyBlock title="Scanner unavailable" body={result?.error || 'No scanner data for this token.'} />
      ) : (
        <div className="flag-grid contract-grid">
          {flags.map((flag) => (
            <div className={`flag-card ${flag.tone}`} key={flag.label}>
              <span>{flag.label}</span>
              <strong>{flag.value}</strong>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function contractChecks(sources: Array<Record<string, unknown>>) {
  const checks = [
    contractFlag('Honeypot', readValue(sources, 'honeypot', 'is_honeypot', 'isHoneypot'), true),
    contractFlag('Renounced', readValue(sources, 'ownership_renounced', 'ownershipRenounced', 'renounced', 'owner_renounced'), false),
    contractFlag('Mintable', readValue(sources, 'mintable', 'is_mintable', 'can_mint'), true),
    contractFlag('Freezable', readValue(sources, 'freezable', 'is_freezable', 'can_freeze'), true),
    contractFlag('Drainable', readValue(sources, 'drainable', 'is_drainable', 'can_drain'), true),
    contractFlag('Pausable', readValue(sources, 'pausable', 'is_pausable', 'can_pause'), true),
    contractFlag('Verified', readValue(sources, 'verified', 'is_verified', 'contract_verified'), false),
    contractFlag('Proxy contract', readValue(sources, 'proxy', 'is_proxy', 'proxy_contract'), true),
    taxFlag(readValue(sources, 'tax', 'taxes', 'buy_tax', 'sell_tax'))
  ];

  return checks;
}

function readValue(sources: Array<Record<string, unknown>>, ...keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  for (const source of sources) {
    const nested = findNestedValue(source, keys);
    if (nested !== undefined && nested !== null && nested !== '') return nested;
  }
  return undefined;
}

function findNestedValue(value: unknown, keys: string[], seen = new Set<unknown>()): unknown {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const nested = row[key];
    if (nested !== undefined && nested !== null && nested !== '') return nested;
  }
  for (const nested of Object.values(row)) {
    const found = findNestedValue(nested, keys, seen);
    if (found !== undefined && found !== null && found !== '') return found;
  }
  return undefined;
}

function contractFlag(label: string, rawValue: unknown, badWhenTrue: boolean) {
  const parsed = readBooleanish(rawValue);
  const value = parsed === null ? formatObjectValue(rawValue) : parsed ? 'YES' : 'NO';
  const tone = parsed === null ? 'neutral' : parsed === badWhenTrue ? 'bad' : 'good';
  return { label, value, tone };
}

function taxFlag(rawValue: unknown) {
  const tax = readTaxValue(rawValue);
  if (tax) {
    const hasTax = /[1-9]/.test(tax.replace(/N\/A/g, ''));
    return { label: 'Tax', value: tax, tone: hasTax ? 'bad' : 'good' };
  }
  return { label: 'Tax', value: formatObjectValue(rawValue), tone: rawValue === undefined ? 'neutral' : 'good' };
}

function readBooleanish(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'detected', 'risk', 'risky', '1'].includes(normalized)) return true;
    if (['false', 'no', 'not detected', 'safe', 'ok', '0'].includes(normalized)) return false;
    return null;
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const nested = readValue([row], 'value', 'result', 'status', 'detected', 'flagged', 'is_honeypot', 'isHoneypot', 'is_proxy', 'renounced', 'verified');
    return nested === value ? null : readBooleanish(nested);
  }
  return null;
}

function readTaxValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'number') return formatPercent(value);
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    const buy = readValue([row], 'buy', 'buy_tax', 'buyTax');
    const sell = readValue([row], 'sell', 'sell_tax', 'sellTax');
    if (buy !== undefined || sell !== undefined) {
      return `Buy ${formatPercent(buy, 'N/A')} / Sell ${formatPercent(sell, 'N/A')}`;
    }
    const nested = readValue([row], 'value', 'result', 'tax', 'total', 'percent', 'percentage');
    return nested === value ? '' : readTaxValue(nested);
  }
  return '';
}

function formatObjectValue(value: unknown) {
  if (value === undefined || value === null || value === '') return 'UNKNOWN';
  if (typeof value !== 'object') return String(value).toUpperCase();
  const row = value as Record<string, unknown>;
  const message = readValue([row], 'message', 'label', 'reason', 'description');
  if (typeof message === 'string' && message.trim()) return message.trim().toUpperCase();
  return 'UNKNOWN';
}

export function LiquidityLockSummary({ scanner }: { scanner: ScannerResponse | null }) {
  const rows = liquidityPoolRows(scanner).slice(0, 3);

  return (
    <Card className="liquidity-lock-card">
      <SectionHeader icon={<Lock size={20} />} title="Liquidity Pool Lock" />
      {rows.length ? (
        <div className="liquidity-pool-list">
          {rows.map((row, index) => (
            <div className="liquidity-pool-row" key={`${row.poolName}-${row.pair}-${index}`}>
              <div>
                <strong>{row.poolName}</strong>
                {row.pair ? <span>{row.pair}</span> : null}
              </div>
              <b>{row.lockedAmount}</b>
            </div>
          ))}
        </div>
      ) : (
        <div className="liquidity-pool-empty">No locked liquidity pool was reported for this token.</div>
      )}
    </Card>
  );
}

export function DrainRiskSummary({ clusterBalance, totalSupply, liquidity, loading, error }: {
  clusterBalance: number | null;
  totalSupply?: number | null;
  liquidity: LiveTokenLiquidity | null;
  loading: boolean;
  error: string | null;
}) {
  const clusterShare = clusterBalance && totalSupply ? (clusterBalance / totalSupply) * 100 : null;
  const clusterUsd = clusterBalance && liquidity?.tokenPriceUsd ? clusterBalance * liquidity.tokenPriceUsd : null;
  const ratio = clusterUsd && liquidity?.liquidityUsd ? clusterUsd / liquidity.liquidityUsd : null;
  const highRisk = ratio !== null && ratio >= 1;

  return (
    <Card className="drain-card">
      <SectionHeader icon={<XCircle size={20} />} title="Drain risk" />
      {loading ? (
        <div className="inline-loading"><Loader2 size={18} /> Checking live liquidity</div>
      ) : error ? (
        <EmptyBlock title="Liquidity unavailable" body={error} />
      ) : (
        <div className="drain-grid">
          <MetricCard label="Cluster held supply" value={formatCurrencyCompact(clusterUsd)} detail={clusterShare !== null ? `${formatPercent(clusterShare)} of supply` : 'N/A of supply'} />
          <MetricCard label="Live liquidity" value={formatCurrencyCompact(liquidity?.liquidityUsd)} detail={liquidity ? `${liquidity.pairCount} live pairs` : 'No live pairs'} />
          <MetricCard label="Liquidity held" value={ratio === null ? 'N/A' : `${(ratio * 100).toFixed(1)}%`} tone={highRisk ? 'danger' : 'safe'} detail={highRisk ? 'Cluster supply can exceed live liquidity' : 'Visible liquidity covers cluster value'} />
        </div>
      )}
    </Card>
  );
}

export function ManipulationPanel({ overview, snipers, bundlers, insiders, labels, totalSupply, tokenPriceUsd }: {
  overview: DexMetrics | null;
  snipers: SnipersResponse | null;
  bundlers: BundlersResponse | null;
  insiders: InsidersResponse | null;
  labels: LabelMap;
  totalSupply?: number | null;
  tokenPriceUsd?: number | null;
}) {
  const [tab, setTab] = useState<'bundlers' | 'snipers' | 'insiders'>('bundlers');
  const [expanded, setExpanded] = useState(false);
  const activeRows = tab === 'bundlers' ? bundlers?.bundlers || [] : tab === 'snipers' ? snipers?.snipers || [] : insiders?.insiders || [];
  const activeEmpty = tab === 'bundlers' ? 'No bundler wallets found.' : tab === 'snipers' ? 'No sniper wallets found.' : 'No insider wallets found.';
  const detailRowCount = (bundlers?.bundlers?.length || 0) + (snipers?.snipers?.length || 0) + (insiders?.insiders?.length || 0);
  const bundlersPct = bundlers?.total_bundlers_pct ?? overview?.bundlers_pct;
  const snipersPct = snipers?.total_sniper_pct ?? overview?.snipers_pct;
  const insidersPct = insiders?.total_insiders_pct ?? overview?.insiders_pct;

  return (
    <Card>
      <SectionHeader icon={<Radar size={20} />} title="Launch Manipulation" eyebrow="Bundlers, snipers, insiders" />
      <div className="metric-grid three">
        <MetricCard label="Bundlers" value={<MetricSplit percent={bundlersPct} usd={manipulationUsd(bundlersPct, totalSupply, tokenPriceUsd)} />} detail={`${formatNumber(bundlers?.bundlers?.length, '0')} wallet interaction`} />
        <MetricCard label="Snipers" value={<MetricSplit percent={snipersPct} usd={manipulationUsd(snipersPct, totalSupply, tokenPriceUsd)} />} detail={`${formatNumber(snipers?.count?.total, '0')} wallet interaction`} />
        <MetricCard label="Insiders" value={<MetricSplit percent={insidersPct} usd={manipulationUsd(insidersPct, totalSupply, tokenPriceUsd)} />} detail={`${formatNumber(insiders?.insiders?.length, '0')} wallet interaction`} />
      </div>
      {detailRowCount ? (
        <div className="section-toggle-row">
          <button className="secondary-pill large" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? 'Hide details' : `See details (${formatNumber(detailRowCount)})`}
          </button>
        </div>
      ) : null}
      {expanded ? (
        <div className="stacked-tables">
          <div className="segmented-tabs" role="tablist" aria-label="Launch manipulation wallet type">
            {(['bundlers', 'snipers', 'insiders'] as const).map((item) => (
              <button type="button" className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <WalletTable rows={activeRows} labels={labels} totalSupply={totalSupply} empty={activeEmpty} maxRows={80} />
        </div>
      ) : null}
    </Card>
  );
}

function manipulationUsd(percentValue: unknown, totalSupply?: number | null, tokenPriceUsd?: number | null) {
  const percent = normalizePercentValue(percentValue);
  const supply = Number(totalSupply);
  const price = Number(tokenPriceUsd);
  if (percent === null || !Number.isFinite(supply) || supply <= 0 || !Number.isFinite(price) || price <= 0) return null;
  return ((supply * percent) / 100) * price;
}

function MetricSplit({ percent, usd }: { percent: unknown; usd: number | null }) {
  return (
    <span className="metric-split">
      <span>{formatPercent(percent)}</span>
      <small className="metric-side-value">{formatCurrencyCompact(usd)}</small>
    </span>
  );
}

export function LiquidityAndHoldersPanel({ scanner, labels, totalSupply }: {
  scanner: ScannerResponse | null;
  labels: LabelMap;
  totalSupply?: number | null;
}) {
  const holders = scannerAdvanced(scanner).top_holders;
  const holderCount = Array.isArray(holders) ? holders.length : 0;
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <SectionHeader
        icon={<Users size={20} />}
        title="Top Holders"
        eyebrow="Largest balances"
        action={holderCount ? (
          <button className="secondary-pill" type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
            {expanded ? 'Hide holders' : `Show holders (${formatNumber(holderCount)})`}
          </button>
        ) : null}
      />
      {!holderCount ? (
        <EmptyBlock title="No holder rows" body="No top holder details for this scan." />
      ) : expanded ? (
        <WalletTable rows={holders || []} labels={labels} totalSupply={totalSupply} empty="No top holder details for this scan." maxRows={80} />
      ) : null}
    </Card>
  );
}
