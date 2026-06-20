import { Activity, Boxes, CircleDot, ShieldAlert, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ClusterData, TokenHolder, TokenMap, TokenMetrics } from '../../shared/bubblemaps';
import { formatCompact, formatNumber, formatPercent, formatPercentPoints, shortenAddress } from './format';
import { clusterList, clusterSupplyPercent, holderSupplyPercent, largestCluster } from './safe-scan-data';
import { Card, EmptyBlock, MetricCard, SectionHeader, type LabelMap } from './ui';
import { WalletTable } from './WalletTable';

function asPercent(value: unknown) {
  return formatPercent(typeof value === 'number' && value <= 1 ? value * 100 : value);
}

function asClusterPercent(value: unknown) {
  return formatPercentPoints(value);
}

export function clusterMemberPercent(value: number | null | undefined, clusterPercent: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (clusterPercent && value > clusterPercent && value / 100 <= clusterPercent) return value / 100;
  return value;
}

function scoreTone(score: number | undefined) {
  if (!Number.isFinite(score)) return '';
  if (Number(score) >= 70) return 'safe';
  if (Number(score) < 40) return 'danger';
  return '';
}

export function ScorePanel({ metrics }: { metrics: TokenMetrics | null }) {
  if (!metrics) {
    return (
      <Card>
        <SectionHeader icon={<ShieldAlert size={20} />} title="Bubblemaps Score" eyebrow="Decentralization" />
        <EmptyBlock title="Metrics unavailable" body="Bubblemaps did not return score data for this token." />
      </Card>
    );
  }

  return (
    <Card>
      <SectionHeader icon={<ShieldAlert size={20} />} title="Bubblemaps Score" eyebrow="Decentralization" />
      <div className="metric-grid four">
        <MetricCard label="Score" value={formatNumber(metrics.scores.bubblemaps_score)} tone={scoreTone(metrics.scores.bubblemaps_score)} detail="Distribution score" />
        <MetricCard label="Gini index" value={formatNumber(metrics.scores.gini_index)} detail="Holder inequality" />
        <MetricCard label="HHI" value={formatNumber(metrics.scores.herfindahl_hirschman_index)} detail="Concentration index" />
        <MetricCard label="Nakamoto" value={formatNumber(metrics.scores.nakamoto_coefficient)} detail="Entities needed for 50%" />
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
    <Card>
      <SectionHeader icon={<Activity size={20} />} title="Supply Exposure" eyebrow="Holder types" />
      {!stats ? <EmptyBlock title="Supply stats unavailable" body="No Bubblemaps supply stats were returned." /> : null}
      <div className="metric-grid supply-metric-grid">
        <MetricCard label="CEX wallets" value={asPercent(stats?.cexs)} detail="Centralized exchange share" />
        <MetricCard label="DEX wallets" value={asPercent(stats?.dexs)} detail="Liquidity venue share" />
        <MetricCard label="Contracts" value={asPercent(stats?.contracts)} detail="Contract-held supply" />
        <MetricCard label="Fresh wallets" value={asPercent(stats?.fresh_wallets)} detail="New wallet exposure" />
        <MetricCard label="Top 10 adjusted" value={asPercent(stats?.top_10_adjusted)} detail="Top holders after adjustments" />
        <MetricCard label="Bundles" value={asPercent(stats?.bundles)} detail="Bundled holder share" />
        <MetricCard label="Largest holder" value={topHolder ? asClusterPercent(holderSupplyPercent(topHolder, totalSupply || null)) : 'N/A'} detail={topHolder ? shortenAddress(topHolder.address) : 'No holders returned'} />
        <MetricCard label="Largest cluster" value={largestCluster ? asClusterPercent(clusterSupplyPercent(largestCluster, totalSupply || null)) : 'N/A'} detail={largestCluster ? `${formatNumber(largestCluster.holder_count)} linked holders` : 'No clusters returned'} />
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
      <div className="metric-grid three">
        <MetricCard label="Tracked holders" value={formatNumber(holderCount)} detail="Indexed wallets" />
        <MetricCard label="Top 10 share" value={asClusterPercent(topTenShare)} detail="Top holder concentration" />
        <MetricCard label="Largest holder" value={holders[0] ? asClusterPercent(holderSupplyPercent(holders[0], totalSupply || null)) : 'N/A'} detail={holders[0] ? shortenAddress(holders[0].address) : 'No holders'} />
      </div>
      {expanded ? (
        <div className="stacked-tables">
          <WalletTable rows={holders} labels={labels} empty="No top holder details for this scan." maxRows={120} totalSupply={totalSupply} />
        </div>
      ) : null}
    </Card>
  );
}

export function ClusterRiskPanel({ map, holders, labels, totalSupply }: {
  map: TokenMap | null;
  holders: TokenHolder[];
  labels: LabelMap;
  totalSupply?: number | null;
}) {
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const clusters = useMemo(() => clusterList(map?.clusters || []), [map]);
  const holderShares = useMemo(() => {
    const rows = [...(map?.nodes?.top_holders || []), ...holders];
    return new Map(rows.map((holder) => [holder.address.toLowerCase(), holderSupplyPercent(holder, totalSupply || null)]));
  }, [holders, map, totalSupply]);
  const largest = largestCluster(clusters);
  const totalClusterShare = clusters.reduce((sum, cluster) => sum + Number(clusterSupplyPercent(cluster, totalSupply || null) || 0), 0);

  return (
    <Card>
      <SectionHeader icon={<Boxes size={20} />} title="Cluster Risk" eyebrow="Linked holder groups" />
      <div className="metric-grid three">
        <MetricCard label="Clusters" value={formatNumber(clusters.length)} detail="Linked holder groups" />
        <MetricCard label="Largest cluster" value={largest ? asClusterPercent(clusterSupplyPercent(largest, totalSupply || null)) : 'N/A'} detail={largest ? `${formatNumber(largest.holder_count)} holders` : 'No clusters'} />
        <MetricCard label="Clustered supply" value={asClusterPercent(totalClusterShare)} detail="Supply in linked groups" />
      </div>
      {clusters.length ? (
        <div className="cluster-risk-list">
          {clusters.slice(0, 10).map((cluster, index) => {
            const key = `cluster-${index}`;
            const expanded = expandedCluster === key;
            return (
              <div className="cluster-risk-row" key={key}>
                <button type="button" onClick={() => setExpandedCluster(expanded ? null : key)} aria-expanded={expanded}>
                  <span><CircleDot size={16} /> Cluster {index + 1}</span>
                  <strong>{asClusterPercent(clusterSupplyPercent(cluster, totalSupply || null))}</strong>
                  <small>{formatCompact(cluster.amount)} tokens / {formatNumber(cluster.holder_count)} holders</small>
                </button>
                {expanded ? (
                  <ClusterMembers
                    cluster={cluster}
                    labels={labels}
                    holderShares={holderShares}
                    clusterPercent={clusterSupplyPercent(cluster, totalSupply || null)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </Card>
  );
}

function ClusterMembers({ cluster, labels, holderShares, clusterPercent }: {
  cluster: ClusterData;
  labels: LabelMap;
  holderShares: Map<string, number | null>;
  clusterPercent: number | null;
}) {
  return (
    <div className="cluster-members compact">
      {cluster.holders.slice(0, 80).map((address, index) => {
        const normalizedAddress = address.toLowerCase();
        const metadata = labels.get(normalizedAddress);
        const share = clusterMemberPercent(holderShares.get(normalizedAddress), clusterPercent);
        return (
          <button type="button" key={address}>
            <span>#{index + 1}</span>
            <strong>{metadata?.address_details.label || shortenAddress(address)}</strong>
            <em>{asClusterPercent(share)}</em>
            <b>{metadata?.address_details.is_cex ? 'CEX' : metadata?.address_details.is_dex ? 'DEX' : metadata?.address_details.is_contract ? 'Contract' : 'Wallet'}</b>
          </button>
        );
      })}
    </div>
  );
}
