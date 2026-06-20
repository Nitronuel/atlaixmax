import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { ClusterRiskPanel, clusterMemberPercent } from './SafeScanPanels';

describe('Safe Scan panel percent guards', () => {
  it('treats impossible cluster-member percentages as percent-point values', () => {
    expect(clusterMemberPercent(95.2, 14.7)).toBeCloseTo(0.952);
  });

  it('keeps member percentages that fit inside the cluster share', () => {
    expect(clusterMemberPercent(1.85, 14.7)).toBe(1.85);
  });

  it('renders sub-1 percent-point cluster members without scaling them back up', () => {
    render(
      createElement(ClusterRiskPanel, {
        map: {
          metadata: {},
          metrics: {
            supply_stats: { cexs: 0, dexs: 0, contracts: 0, fresh_wallets: 0, top_10_adjusted: 0, bundles: 0 },
            scores: { bubblemaps_score: 0, gini_index: 0, herfindahl_hirschman_index: 0, nakamoto_coefficient: 0 }
          },
          nodes: {
            top_holders: [
              { address: '0x1111111111111111111111111111111111111111', holder_data: { amount: 18_500_000, rank: 1, share: 0.0185 } },
              { address: '0x2222222222222222222222222222222222222222', holder_data: { amount: 9_520_000, rank: 2, share: 0.952 } }
            ]
          },
          clusters: [{
            amount: 147_000_000,
            share: 14.7,
            holder_count: 2,
            holders: [
              '0x1111111111111111111111111111111111111111',
              '0x2222222222222222222222222222222222222222'
            ]
          }]
        },
        holders: [],
        labels: new Map()
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /cluster 1/i }));

    const members = screen.getByText('#2').closest('button');
    expect(members).not.toBeNull();
    expect(within(members as HTMLElement).getByText('0.95%')).toBeInTheDocument();
    expect(screen.queryByText('95.2%')).not.toBeInTheDocument();
  });
});
