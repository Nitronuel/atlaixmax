import { useEffect, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import {
  type BubblemapsChain,
  type BubblemapsScanReport,
  type ClusterData,
  type TokenMetrics,
  getBubblemapsChainLabel,
  isLikelyBubblemapsAddress,
  normalizeBubblemapsChain
} from '../../shared/bubblemaps';
import type { SecurityScannerReport } from '../../shared/security-scanner';
import { AtlasPanel } from './AtlasPanel';
import { formatNumber, formatPercent, formatPercentPoints, normalizePercentValue } from './format';
import { clusterSupplyPercent, endpointData, inferredTotalSupply, labelMap, largestCluster } from './safe-scan-data';
import { type DetectedTokenNetwork, type LiveTokenLiquidity, SafeScanService } from './safe-scan-service';
import { SafeScanEmptyState } from './SafeScanEmptyState';
import {
  HolderConcentrationPanel,
  LiquidityPoolLockPanel,
  ScorePanel,
  SecurityScannerPanel,
  SupplyExposurePanel,
  TokenSafetyReportPanel
} from './SafeScanPanels';
import { Card, SectionHeader } from './ui';

function distributionRead(value: number) {
  if (!Number.isFinite(value)) return 'an unavailable distribution profile';
  const score = value > 0 && value <= 1 ? value * 100 : value;
  if (score < 40) return 'a weak distribution profile';
  if (score < 65) return 'a mixed distribution profile';
  return 'a healthier distribution profile';
}

function holderControlRead(inequality: number, concentration: number, entityThreshold: number) {
  if (Number.isFinite(entityThreshold) && entityThreshold <= 1) {
    return 'One connected holder group appears large enough to cross the main control threshold, so users should treat the supply as dependent on a single dominant group.';
  }
  if (Number.isFinite(entityThreshold) && entityThreshold <= 3) {
    return 'Only a few connected holder groups appear needed to reach the main control threshold, so ownership is still narrow.';
  }
  if (Number.isFinite(concentration) && concentration >= 0.3) {
    return 'Holder control still looks concentrated, with a small group carrying much of the visible supply.';
  }
  if (Number.isFinite(inequality) && inequality >= 0.65) {
    return 'Holder balances are uneven, so the map still deserves a concentration check.';
  }
  return 'Holder control looks more spread out than a tightly concentrated map.';
}

function bundleRead(value: number | null) {
  if (value === null || value <= 0) return 'No material bundle exposure is visible.';
  if (value >= 50) return `The bundle figure is ${formatPercent(value)}, a high share that can point to related launch wallets or coordinated holder groups.`;
  if (value >= 15) return `The bundle figure is ${formatPercent(value)}, a meaningful share that users should read as possible related-wallet exposure.`;
  return `The bundle figure is ${formatPercent(value)}, which keeps bundled-wallet exposure limited.`;
}

function clusterRead(cluster: ClusterData | null | undefined, share: number | null) {
  if (!cluster) return 'No linked holder cluster was returned, so the scan cannot show a dominant connected wallet group.';
  return `The largest visible cluster controls ${formatPercentPoints(share)} across ${formatNumber(cluster.holder_count)} holders, so those wallets should be read as one connected supply group.`;
}

function buildAiAssessment({
  tokenLabel,
  chainLabel,
  metrics,
  largest,
  totalSupply
}: {
  tokenLabel: string;
  chainLabel: string;
  metrics: TokenMetrics | null;
  largest?: ClusterData | null;
  totalSupply: number | null;
}) {
  if (!metrics) {
    return `Key read: ${tokenLabel} on ${chainLabel} does not have enough distribution data for a full holder-structure read. The scan can only use any returned bundle or cluster data, so users should treat the assessment as limited and non-predictive.`;
  }

  const score = Number(metrics.scores.bubblemaps_score);
  const gini = Number(metrics.scores.gini_index);
  const hhi = Number(metrics.scores.herfindahl_hirschman_index);
  const nakamoto = Number(metrics.scores.nakamoto_coefficient);
  const supply = metrics.supply_stats;
  const largestClusterPercent = largest ? clusterSupplyPercent(largest, totalSupply) : null;
  const bundlePercent = normalizePercentValue(supply.bundles);

  return `Key read: ${tokenLabel} on ${chainLabel} has ${distributionRead(score)}, with ownership leaning toward connected-wallet concentration. ${holderControlRead(gini, hhi, nakamoto)} ${bundleRead(bundlePercent)} ${clusterRead(largest, largestClusterPercent)} This is a holder-structure read, not a price prediction.`;
}

export function SafeScanPage() {
  const [searchParams] = useState(() => new URLSearchParams(window.location.search));
  const [address, setAddress] = useState('');
  const [chain, setChain] = useState<BubblemapsChain>('eth');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<BubblemapsScanReport | null>(null);
  const [liveLiquidity, setLiveLiquidity] = useState<LiveTokenLiquidity | null>(null);
  const [liquidityLoading, setLiquidityLoading] = useState(false);
  const [liquidityError, setLiquidityError] = useState<string | null>(null);
  const [securityReport, setSecurityReport] = useState<SecurityScannerReport | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [detectedNetwork, setDetectedNetwork] = useState<DetectedTokenNetwork | null>(null);
  const [detectingNetwork, setDetectingNetwork] = useState(false);
  const [manualChainOverride, setManualChainOverride] = useState(false);

  const normalizedAddress = address.trim();
  const addressSupported = !normalizedAddress || isLikelyBubblemapsAddress(normalizedAddress, chain);
  const token = endpointData(report?.endpoints.token);
  const metrics = endpointData(report?.endpoints.metrics);
  const holders = endpointData(report?.endpoints.holders) || [];
  const map = endpointData(report?.endpoints.map);
  const clusters = map?.clusters || [];
  const totalSupply = useMemo(() => inferredTotalSupply(clusters, [...(map?.nodes?.top_holders || []), ...holders]), [clusters, holders, map]);
  const labels = useMemo(() => labelMap([...(map?.nodes?.top_holders || []), ...holders]), [holders, map]);
  const topHolder = holders[0];
  const largest = largestCluster(clusters);
  const tokenLabel = token?.metadata.name || token?.metadata.symbol || 'This token';
  const chainLabel = report ? getBubblemapsChainLabel(report.chain) : getBubblemapsChainLabel(chain);
  const aiAssessment = report ? buildAiAssessment({
    tokenLabel,
    chainLabel,
    metrics,
    largest,
    totalSupply
  }) : '';

  useEffect(() => {
    if (!normalizedAddress || loading) {
      setDetectedNetwork(null);
      setDetectingNetwork(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setDetectingNetwork(true);
      SafeScanService.detectTokenNetwork(normalizedAddress)
        .then((detection) => {
          if (cancelled) return;
          setDetectedNetwork(detection);
          if (detection && detection.chain !== chain && !manualChainOverride) setChain(detection.chain);
        })
        .catch(() => {
          if (!cancelled) setDetectedNetwork(null);
        })
        .finally(() => {
          if (!cancelled) setDetectingNetwork(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedAddress, loading, chain, manualChainOverride]);

  useEffect(() => {
    const queryAddress = searchParams.get('address')?.trim() || '';
    const queryChain = normalizeBubblemapsChain(searchParams.get('chain') || searchParams.get('network')) || 'eth';
    if (!queryAddress) return;

    setAddress(queryAddress);
    setChain(queryChain);
    if (searchParams.get('autoScan') === '1' && isLikelyBubblemapsAddress(queryAddress, queryChain)) {
      void runScan(queryChain, queryAddress);
    }
  }, []);

  useEffect(() => {
    if (!report) {
      setLiveLiquidity(null);
      setLiquidityLoading(false);
      setLiquidityError(null);
      return;
    }

    let cancelled = false;
    setLiquidityLoading(true);
    setLiquidityError(null);
    SafeScanService.getLiveTokenLiquidity(report.chain, report.address)
      .then((liquidity) => {
        if (!cancelled) setLiveLiquidity(liquidity);
      })
      .catch((nextError) => {
        if (!cancelled) setLiquidityError(nextError instanceof Error ? nextError.message : 'Could not load live liquidity.');
      })
      .finally(() => {
        if (!cancelled) setLiquidityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  useEffect(() => {
    if (!report) {
      setSecurityReport(null);
      setSecurityLoading(false);
      setSecurityError(null);
      return;
    }

    let cancelled = false;
    setSecurityLoading(true);
    setSecurityError(null);
    SafeScanService.getSecurityScannerReport(report.chain, report.address)
      .then((nextReport) => {
        if (!cancelled) setSecurityReport(nextReport);
      })
      .catch((nextError) => {
        if (!cancelled) setSecurityError(nextError instanceof Error ? nextError.message : 'Could not load contract checks.');
      })
      .finally(() => {
        if (!cancelled) setSecurityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  async function runScan(scanChain = chain, scanAddress = normalizedAddress) {
    if (!scanAddress) return;
    setLoading(true);
    setError(null);
    try {
      let nextChain = scanChain;
      if (!manualChainOverride) {
        const detection = detectedNetwork || await SafeScanService.detectTokenNetwork(scanAddress).catch(() => null);
        if (detection && isLikelyBubblemapsAddress(scanAddress, detection.chain)) {
          nextChain = detection.chain;
          setDetectedNetwork(detection);
          setChain(detection.chain);
        }
      }
      if (!isLikelyBubblemapsAddress(scanAddress, nextChain)) return;
      const nextReport = await SafeScanService.scanToken(nextChain, scanAddress);
      const hasUsableData = endpointData(nextReport.endpoints.token) ||
        endpointData(nextReport.endpoints.metrics) ||
        (endpointData(nextReport.endpoints.holders) || []).length ||
        endpointData(nextReport.endpoints.map);
      if (!hasUsableData) {
        throw new Error(`No Bubblemaps data was found for this token on ${getBubblemapsChainLabel(nextChain)}. Try another chain or a token that is indexed by Bubblemaps.`);
      }
      setReport(nextReport);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Bubblemaps scan failed.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setReport(null);
    setLiveLiquidity(null);
    setLiquidityLoading(false);
    setLiquidityError(null);
    setSecurityReport(null);
    setSecurityLoading(false);
    setSecurityError(null);
    setError(null);
    setDetectedNetwork(null);
    setDetectingNetwork(false);
    setManualChainOverride(false);
    setAddress('');
    setChain('eth');
  }

  if (!report) {
    return (
      <SafeScanEmptyState
        address={address}
        chain={chain}
        loading={loading}
        error={error}
        detectedNetwork={detectedNetwork}
        detectingNetwork={detectingNetwork}
        addressSupported={addressSupported}
        onAddressChange={(nextAddress) => {
          setAddress(nextAddress);
          setManualChainOverride(false);
        }}
        onChainChange={(nextChain) => {
          setChain(nextChain);
          setManualChainOverride(true);
        }}
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
          <h1>Safe Scan</h1>
          <p>Holder concentration, linked wallets, supply exposure, and transfer relationships.</p>
        </div>
        <button type="button" className="primary-button compact" onClick={reset}>
          <Shield size={18} /> New scan
        </button>
      </Card>

      <div className="safe-scan-safety-grid">
        <TokenSafetyReportPanel
          token={token}
          address={report.address}
          chainLabel={getBubblemapsChainLabel(report.chain)}
          clusters={clusters}
          totalSupply={totalSupply}
        />
        <LiquidityPoolLockPanel
          clusters={clusters}
          totalSupply={totalSupply}
          liquidity={liveLiquidity}
          lockReport={securityReport?.liquidityLock || null}
          lockLoading={securityLoading}
          lockError={securityError}
          loading={liquidityLoading}
          error={liquidityError}
        />
      </div>

      <SecurityScannerPanel report={securityReport} loading={securityLoading} error={securityError} />

      <Card className="ai-assessment-card">
        <SectionHeader icon={<Shield size={20} />} title="AI Assessment" eyebrow="Safe Scan read" />
        <p>{aiAssessment}</p>
      </Card>

      <div className="safe-scan-intelligence-grid">
        <ScorePanel metrics={metrics} />
        <SupplyExposurePanel metrics={metrics} topHolder={topHolder} largestCluster={largest} totalSupply={totalSupply} />
      </div>
      <HolderConcentrationPanel holders={holders} labels={labels} totalSupply={totalSupply} />
      <AtlasPanel map={map} clusters={clusters} labels={labels} />
    </div>
  );
}
