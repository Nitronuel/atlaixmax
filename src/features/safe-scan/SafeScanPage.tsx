import { useEffect, useMemo, useState } from 'react';
import { Copy, Shield } from 'lucide-react';
import {
  type AtlasSnapshot,
  type BundlersResponse,
  type DexMetrics,
  type InsightXNetwork,
  type InsidersResponse,
  type SafeScanReport,
  type ScannerResponse,
  type SnipersResponse,
  isLikelyInsightXAddress,
  normalizeInsightXNetwork
} from '../../shared/insightx';
import { AtlasPanel } from './AtlasPanel';
import { formatAge, formatCompact, formatCurrencyCompact, formatPercent, shortenAddress } from './format';
import {
  clusterSupplyBalance,
  collectLabels,
  creatorSupplyShare,
  endpointData,
  inferSupplyFromClusters,
  labelMap
} from './safe-scan-data';
import { type DetectedTokenNetwork, type LiveTokenLiquidity, SafeScanService } from './safe-scan-service';
import { SafeScanEmptyState } from './SafeScanEmptyState';
import {
  DrainRiskSummary,
  LiquidityAndHoldersPanel,
  LiquidityLockSummary,
  ManipulationPanel,
  ScannerPanel
} from './SafeScanPanels';
import { Card, MetricCard } from './ui';

export function SafeScanPage() {
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState<InsightXNetwork>('sol');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SafeScanReport | null>(null);
  const [liveLiquidity, setLiveLiquidity] = useState<LiveTokenLiquidity | null>(null);
  const [liquidityLoading, setLiquidityLoading] = useState(false);
  const [liquidityError, setLiquidityError] = useState<string | null>(null);
  const [detectedNetwork, setDetectedNetwork] = useState<DetectedTokenNetwork | null>(null);
  const [detectingNetwork, setDetectingNetwork] = useState(false);

  const normalizedAddress = address.trim();
  const addressSupported = !normalizedAddress || isLikelyInsightXAddress(normalizedAddress, network);
  const scanner = endpointData<ScannerResponse>(report?.endpoints.scanner);
  const overview = endpointData<DexMetrics>(report?.endpoints.overview);
  const snipers = endpointData<SnipersResponse>(report?.endpoints.snipers);
  const bundlers = endpointData<BundlersResponse>(report?.endpoints.bundlers);
  const insiders = endpointData<InsidersResponse>(report?.endpoints.insiders);
  const clusters = endpointData<unknown>(report?.endpoints.clusters);
  const atlas = endpointData<AtlasSnapshot>(report?.endpoints.atlasLatest);
  const atlasTimestamps = endpointData<unknown>(report?.endpoints.atlasTimestamps);
  const labels = useMemo(() => labelMap(collectLabels(endpointData(report?.endpoints.labels))), [report]);
  const inferredSupply = useMemo(() => inferSupplyFromClusters(clusters), [clusters]);
  const tokenTotalSupply = Number(scanner?.token?.total_supply) > 0 ? Number(scanner?.token?.total_supply) : inferredSupply ?? undefined;
  const detectedClusterBalance = clusterSupplyBalance(clusters, tokenTotalSupply, overview?.cluster_pct);
  const clusterUsd = detectedClusterBalance !== null && liveLiquidity?.tokenPriceUsd ? detectedClusterBalance * liveLiquidity.tokenPriceUsd : null;

  useEffect(() => {
    if (!normalizedAddress || loading) {
      setDetectedNetwork(null);
      setDetectingNetwork(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setDetectingNetwork(true);
      SafeScanService.detectTokenNetwork(normalizedAddress)
        .then((detection) => {
          setDetectedNetwork(detection);
          if (detection && detection.network !== network) setNetwork(detection.network);
        })
        .catch(() => setDetectedNetwork(null))
        .finally(() => setDetectingNetwork(false));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [normalizedAddress, loading]);

  useEffect(() => {
    if (!report) {
      setLiveLiquidity(null);
      setLiquidityError(null);
      setLiquidityLoading(false);
      return;
    }

    let cancelled = false;
    setLiquidityLoading(true);
    setLiquidityError(null);
    setLiveLiquidity(null);
    SafeScanService.getLiveTokenLiquidity(report.network, report.address)
      .then((liquidity) => {
        if (!cancelled) setLiveLiquidity(liquidity);
      })
      .catch((nextError) => {
        if (!cancelled) setLiquidityError(nextError instanceof Error ? nextError.message : 'Live liquidity is unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLiquidityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  useEffect(() => {
    const queryAddress = searchParams.get('address')?.trim() || '';
    const queryNetwork = normalizeInsightXNetwork(searchParams.get('chain')) || 'sol';
    if (!queryAddress) return;

    setAddress(queryAddress);
    setNetwork(queryNetwork);
    if (searchParams.get('autoScan') === '1' && isLikelyInsightXAddress(queryAddress, queryNetwork)) {
      void runScan(queryNetwork, queryAddress);
    }
  }, []);

  async function runScan(scanNetwork = network, scanAddress = normalizedAddress) {
    if (!scanAddress || !isLikelyInsightXAddress(scanAddress, scanNetwork)) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await SafeScanService.scanToken(scanNetwork, scanAddress));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Safety Scan failed.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setReport(null);
    setError(null);
    setLiveLiquidity(null);
    setLiquidityError(null);
    setDetectedNetwork(null);
    setDetectingNetwork(false);
    setAddress('');
    setNetwork('sol');
  }

  if (!report) {
    return (
      <SafeScanEmptyState
        address={address}
        network={network}
        loading={loading}
        error={error}
        detectedNetwork={detectedNetwork}
        detectingNetwork={detectingNetwork}
        addressSupported={addressSupported}
        onAddressChange={setAddress}
        onNetworkChange={setNetwork}
        onSubmit={(event) => {
          event?.preventDefault();
          void runScan();
        }}
      />
    );
  }

  return (
    <div className="safe-scan-results">
      <Card className="result-hero">
        <div>
          <h1>Safety Scan</h1>
          <p>Check contract flags, holder concentration, launch wallets, labels, and graph links in one scan.</p>
        </div>
        <button type="button" className="primary-button compact" onClick={reset}>
          <Shield size={18} /> New scan
        </button>
      </Card>

      <div className="top-grid">
        <Card className="token-card">
          <div className="token-heading">
            <div className="token-logo">{scanner?.token?.logo ? <img src={scanner.token.logo} alt="" /> : (scanner?.token?.symbol || 'IX').slice(0, 2)}</div>
            <div>
              <h2>{scanner?.token?.name || 'Token Safety Report'}</h2>
              <div className="token-meta">
                <span>{scanner?.token?.symbol || 'N/A'}</span>
                <button type="button" onClick={() => navigator.clipboard?.writeText(report.address)} aria-label="Copy token address">
                  {shortenAddress(report.address)} <Copy size={14} />
                </button>
              </div>
            </div>
          </div>
          <div className="metric-grid">
            <MetricCard label="Supply" value={formatCompact(tokenTotalSupply)} />
            <MetricCard label="Token age" value={formatAge(scanner?.token?.age)} />
            <MetricCard
              label="Cluster supply"
              value={<span className="metric-split"><span>{formatPercent(overview?.cluster_pct)}</span><small className="metric-side-value">{formatCurrencyCompact(clusterUsd)}</small></span>}
              detail="Supply held by detected clusters"
            />
            <MetricCard label="Dev holdings" value={formatPercent(creatorSupplyShare(scanner, overview?.dev_pct))} detail="Creator/deployer exposure" />
          </div>
        </Card>
        <div className="side-stack">
          <LiquidityLockSummary scanner={scanner} />
          <DrainRiskSummary clusterBalance={detectedClusterBalance} totalSupply={tokenTotalSupply} liquidity={liveLiquidity} loading={liquidityLoading} error={liquidityError} />
        </div>
      </div>

      <ScannerPanel scanner={scanner} result={report.endpoints.scanner} />
      <LiquidityAndHoldersPanel scanner={scanner} labels={labels} totalSupply={tokenTotalSupply} />
      {report.network === 'sol' ? (
        <ManipulationPanel overview={overview} snipers={snipers} bundlers={bundlers} insiders={insiders} labels={labels} totalSupply={tokenTotalSupply} tokenPriceUsd={liveLiquidity?.tokenPriceUsd} />
      ) : null}
      <AtlasPanel atlas={atlas} timestamps={atlasTimestamps} clusters={clusters} labels={labels} totalSupply={tokenTotalSupply} />
    </div>
  );
}
