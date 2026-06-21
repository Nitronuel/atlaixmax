import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TokenMap } from '../../shared/bubblemaps';
import { AtlasPanel } from './AtlasPanel';
import type { LabelMap } from './ui';

const addresses = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555'
];

function holder(address: string, rank: number, amount: number, share: number, label?: string) {
  return {
    address,
    address_details: label ? {
      degree: 1,
      inward_relations: 1,
      is_cex: false,
      is_contract: false,
      is_dex: false,
      is_supernode: false,
      label,
      outward_relations: 1
    } : null,
    holder_data: { amount, rank, share }
  };
}

function relationship(from: string, to: string, totalTransfers = 4) {
  return {
    from_address: from,
    to_address: to,
    rel_type: 'GROUPED_TRANSFER' as const,
    data: {
      first_date: 1,
      last_date: 2,
      token_key: { chain: 'eth' as const, address: addresses[0] },
      total_transfers: totalTransfers,
      total_value: 1000
    }
  };
}

function graphFixture(): { map: TokenMap; labels: LabelMap } {
  const topHolders = [
    holder(addresses[0], 1, 100, 0.1, 'Treasury'),
    holder(addresses[1], 2, 80, 0.08, 'Market maker'),
    holder(addresses[2], 3, 40, 0.04),
    holder(addresses[3], 4, 20, 0.02),
    holder(addresses[4], 5, 10, 0.01)
  ];
  const labels: LabelMap = new Map(
    topHolders
      .filter((entry) => entry.address_details)
      .map((entry) => [entry.address.toLowerCase(), { address: entry.address, address_details: entry.address_details! }])
  );

  return {
    labels,
    map: {
      metadata: { dt_update: '2026-06-20T10:00:00Z' },
      metrics: {
        scores: {
          bubblemaps_score: 0.7,
          gini_index: 0.2,
          herfindahl_hirschman_index: 0.1,
          nakamoto_coefficient: 2
        },
        supply_stats: {
          bundles: 0,
          cexs: 0,
          contracts: 0,
          dexs: 0,
          fresh_wallets: 0,
          top_10_adjusted: 0
        }
      },
      nodes: { top_holders: topHolders },
      relationships: [
        relationship(addresses[0], addresses[1], 9),
        relationship(addresses[1], addresses[2], 3),
        relationship(addresses[3], addresses[4], 2)
      ],
      clusters: [
        { amount: 300, share: 0.3, holder_count: 2, holders: [{ wallet_address: addresses[0], holder_data: { amount: 100, rank: 1, share: 0.1 } }, addresses[1]] as unknown as string[] },
        { amount: 70, share: 0.07, holder_count: 2, holders: [addresses[3], addresses[4]] }
      ]
    }
  };
}

function ringFixture(size = 24): { map: TokenMap; labels: LabelMap } {
  const ringAddresses = Array.from({ length: size }, (_, index) => `0x${(index + 1).toString(16).padStart(40, '0')}`);
  const topHolders = ringAddresses.map((address, index) => holder(address, index + 1, 100 - index, Math.max(0.005, 0.06 - index * 0.001)));
  return {
    labels: new Map(),
    map: {
      metadata: { dt_update: '2026-06-20T10:00:00Z' },
      metrics: {
        scores: {
          bubblemaps_score: 0.7,
          gini_index: 0.2,
          herfindahl_hirschman_index: 0.1,
          nakamoto_coefficient: 2
        },
        supply_stats: {
          bundles: 0,
          cexs: 0,
          contracts: 0,
          dexs: 0,
          fresh_wallets: 0,
          top_10_adjusted: 0
        }
      },
      nodes: { top_holders: topHolders },
      relationships: ringAddresses.slice(1).map((address, index) => relationship(ringAddresses[0], address, 2 + index)),
      clusters: [
        { amount: 600, share: 0.6, holder_count: size, holders: ringAddresses }
      ]
    }
  };
}

function clusterPanelButton(name: RegExp) {
  const button = screen.getAllByRole('button', { name }).find((element) => element.classList.contains('cluster-row-main'));
  expect(button).toBeDefined();
  return button as HTMLElement;
}

function transformScale(transform: string | null | undefined = '') {
  return Number((transform ?? '').match(/scale\(([^)]+)\)/)?.[1] ?? 1);
}

function transformView(transform: string | null | undefined = '') {
  const translate = (transform ?? '').match(/translate\(([^ ]+) ([^)]+)\)/);
  return {
    x: Number(translate?.[1] ?? 0),
    y: Number(translate?.[2] ?? 0),
    scale: transformScale(transform)
  };
}

describe('AtlasPanel graph interactions', () => {
  it('renders supply-scaled graph primitives and in-canvas cluster controls', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);

    expect(screen.getByText('Top 5 holders')).toBeInTheDocument();
    expect(screen.getByText('2 clusters')).toBeInTheDocument();
    expect(screen.getByText('3 links')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus Cluster 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Focus Cluster 2' })).toBeInTheDocument();
    expect(container.querySelectorAll('.atlas-node')).toHaveLength(5);
    expect(container.querySelectorAll('.atlas-cluster-halo')).toHaveLength(2);
    expect(container.querySelectorAll('.atlas-link path')).toHaveLength(3);
    expect(container.querySelectorAll('.cluster-share-meter')).toHaveLength(3);
    expect(clusterPanelButton(/Cluster 1/i).style.getPropertyValue('--cluster-share')).toBe('30%');
    expect(screen.getByText('2 routes / 1 internal')).toBeInTheDocument();
  });

  it('syncs cluster selection between the panel and graph without changing the camera', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const transformGroup = container.querySelector('.atlas-svg > g');
    const initialTransform = transformGroup?.getAttribute('transform');

    fireEvent.click(clusterPanelButton(/Cluster 1/i));

    const meta = container.querySelector('.atlas-map-meta');
    expect(meta).not.toBeNull();
    expect(meta).toHaveClass('active');
    expect(within(meta as HTMLElement).getByText('Cluster 1')).toBeInTheDocument();
    expect(within(meta as HTMLElement).getByText('30% supply')).toBeInTheDocument();
    expect(within(meta as HTMLElement).getByText('2 wallets')).toBeInTheDocument();
    expect(within(meta as HTMLElement).getByText('2 routes')).toBeInTheDocument();
    const clusterSummary = container.querySelector('.atlas-popover.cluster-summary');
    expect(clusterSummary).not.toBeNull();
    expect(within(clusterSummary as HTMLElement).getByText('30% supply')).toBeInTheDocument();
    expect(screen.getByText('2 linked wallets')).toBeInTheDocument();
    expect(screen.getByText('Routes')).toBeInTheDocument();
    expect(clusterSummary).toHaveTextContent('2 Routes');
    expect(container.querySelectorAll('.atlas-link.active')).toHaveLength(2);
    expect(transformGroup?.getAttribute('transform')).toBe(initialTransform);
    expect(screen.getByText('Treasury')).toBeInTheDocument();

    fireEvent.click(container.querySelector('.atlas-svg') as SVGSVGElement);

    expect(container.querySelector('.atlas-map-meta')).not.toHaveClass('active');
    expect(container.querySelector('.atlas-popover.cluster-summary')).toBeNull();
  });

  it('zooms from the graph wheel position without losing pan support', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const stage = container.querySelector('.atlas-stage') as HTMLDivElement;
    const transformGroup = container.querySelector('.atlas-svg > g');
    const initialTransform = transformGroup?.getAttribute('transform');

    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1200, height: 760, right: 1200, bottom: 760, x: 0, y: 0, toJSON: () => ({}) })
    });

    fireEvent.wheel(stage, { clientX: 620, clientY: 360, deltaY: -100 });

    const nextTransform = transformGroup?.getAttribute('transform') || '';
    const initialView = transformView(initialTransform);
    const nextView = transformView(nextTransform);
    const worldBefore = {
      x: (620 - initialView.x) / initialView.scale,
      y: (360 - initialView.y) / initialView.scale
    };
    const worldAfter = {
      x: (620 - nextView.x) / nextView.scale,
      y: (360 - nextView.y) / nextView.scale
    };

    expect(initialTransform).toMatch(/^translate\([^)]+\) scale\([^)]+\)$/);
    expect(nextTransform).not.toBe(initialTransform);
    expect(nextTransform).toMatch(/^translate\([^)]+\) scale\([^)]+\)$/);
    expect(transformScale(nextTransform)).toBeGreaterThan(transformScale(initialTransform));
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);
  });

  it('swallows horizontal wheel input instead of panning the graph', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const stage = container.querySelector('.atlas-stage') as HTMLDivElement;
    const transformGroup = container.querySelector('.atlas-svg > g');
    const initialTransform = transformGroup?.getAttribute('transform') || '';

    Object.defineProperty(stage, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 1200, height: 760, right: 1200, bottom: 760, x: 0, y: 0, toJSON: () => ({}) })
    });

    fireEvent.wheel(stage, { clientX: 620, clientY: 360, deltaX: 120, deltaY: 0 });

    const nextTransform = transformGroup?.getAttribute('transform') || '';
    expect(nextTransform).toBe(initialTransform);
  });

  it('zooms toolbar controls around the chart center using the graph transform contract', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const transformGroup = container.querySelector('.atlas-svg > g');
    const initialTransform = transformGroup?.getAttribute('transform') || '';

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    const nextTransform = transformGroup?.getAttribute('transform') || '';
    expect(initialTransform).toMatch(/^translate\([^)]+\) scale\([^)]+\)$/);
    expect(nextTransform).toMatch(/^translate\([^)]+\) scale\([^)]+\)$/);
    expect(transformScale(nextTransform)).toBeGreaterThan(transformScale(initialTransform));
  });

  it('does not start graph panning from the mouse wheel button', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const svg = container.querySelector('.atlas-svg') as SVGSVGElement;
    const transformGroup = container.querySelector('.atlas-svg > g');
    const initialTransform = transformGroup?.getAttribute('transform');

    fireEvent.pointerDown(svg, { button: 1, buttons: 4, clientX: 600, clientY: 360, pointerId: 7 });
    fireEvent.pointerMove(svg, { buttons: 4, clientX: 720, clientY: 360, pointerId: 7 });

    expect(transformGroup?.getAttribute('transform')).toBe(initialTransform);
  });

  it('hides and restores a cluster graph layer from the address list', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide Cluster 1 graph group' }));

    expect(container.querySelectorAll('.atlas-node')).toHaveLength(3);
    expect(container.querySelectorAll('.atlas-cluster-halo')).toHaveLength(1);
    expect(container.querySelectorAll('.atlas-link path')).toHaveLength(1);
    expect(container.querySelectorAll('.atlas-spoke-arrow')).toHaveLength(2);
    expect(screen.getByText('1 hidden')).toBeInTheDocument();
    expect(clusterPanelButton(/Cluster 1/i)).toHaveTextContent('Hidden from graph');

    fireEvent.click(screen.getByRole('button', { name: 'Show Cluster 1 graph group' }));

    expect(container.querySelectorAll('.atlas-node')).toHaveLength(5);
    expect(container.querySelectorAll('.atlas-cluster-halo')).toHaveLength(2);
    expect(container.querySelectorAll('.atlas-link path')).toHaveLength(3);
    expect(container.querySelectorAll('.atlas-spoke-arrow')).toHaveLength(4);
  });

  it('keeps larger visual clusters in hollow ring formation', () => {
    const { map, labels } = ringFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const clusterHalo = screen.getByRole('button', { name: 'Focus Cluster 1' });
    const haloCircle = clusterHalo.querySelector('circle');
    expect(haloCircle).not.toBeNull();
    const centerX = Number(haloCircle?.getAttribute('cx'));
    const centerY = Number(haloCircle?.getAttribute('cy'));
    const nodeDistances = [...container.querySelectorAll('.atlas-node')].map((node) => {
      const bubble = node.querySelectorAll('circle')[1];
      const x = Number(bubble.getAttribute('cx'));
      const y = Number(bubble.getAttribute('cy'));
      return Math.hypot(x - centerX, y - centerY);
    });

    expect(nodeDistances).toHaveLength(24);
    expect(Math.min(...nodeDistances)).toBeGreaterThan(48);
    expect(container.querySelectorAll('.atlas-svg line')).toHaveLength(24);
    expect(container.querySelectorAll('.atlas-spoke-arrow')).toHaveLength(24);
  });

  it('shows cluster context on halo hover and keyboard focus before selection', () => {
    const { map, labels } = graphFixture();
    render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const clusterHalo = screen.getByRole('button', { name: 'Focus Cluster 1' });

    fireEvent.mouseEnter(clusterHalo);

    const hoverCard = screen.getByRole('status');
    expect(within(hoverCard).getByText('Cluster preview')).toBeInTheDocument();
    expect(within(hoverCard).getByText('Cluster 1')).toBeInTheDocument();
    expect(hoverCard).toHaveTextContent('2 wallets / 30% supply');
    expect(within(hoverCard).getByText('Routes')).toBeInTheDocument();
    expect(within(hoverCard).getByText('Internal')).toBeInTheDocument();

    fireEvent.mouseLeave(clusterHalo);

    expect(screen.queryByText('Cluster preview')).not.toBeInTheDocument();

    fireEvent.focus(clusterHalo);

    expect(screen.getByRole('status')).toHaveTextContent('Cluster preview');

    fireEvent.blur(clusterHalo);

    expect(screen.queryByText('Cluster preview')).not.toBeInTheDocument();
  });

  it('shows wallet context on node hover and keyboard focus before selection', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);
    const treasuryNode = screen.getByRole('button', { name: /Treasury, rank 1/i });

    fireEvent.mouseEnter(treasuryNode);

    const meta = container.querySelector('.atlas-map-meta');
    expect(meta).not.toBeNull();
    expect(meta).not.toHaveClass('active');
    expect(within(meta as HTMLElement).getByText('Top 5 holders')).toBeInTheDocument();
    const hoverCard = screen.getByRole('status');
    expect(within(hoverCard).getByText('#1')).toBeInTheDocument();
    expect(within(hoverCard).getByText('Treasury')).toBeInTheDocument();
    expect(within(hoverCard).getByText('10%')).toBeInTheDocument();
    expect(hoverCard).toHaveClass('atlas-node-chip');

    fireEvent.mouseLeave(treasuryNode);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.focus(treasuryNode);

    expect(screen.getByRole('status')).toHaveTextContent('#1');

    fireEvent.blur(treasuryNode);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('selects wallets from the address list and keeps the owning cluster open', () => {
    const { map, labels } = graphFixture();
    const { container } = render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);

    fireEvent.click(clusterPanelButton(/Cluster 1/i));
    const treasuryRow = screen.getByText('Treasury').closest('button');
    expect(treasuryRow).not.toBeNull();
    expect(within(treasuryRow as HTMLElement).getByText('0x1111...11111')).toBeInTheDocument();
    expect(within(treasuryRow as HTMLElement).getByText('10%')).toBeInTheDocument();
    fireEvent.click(treasuryRow as HTMLElement);

    const popover = container.querySelector('.atlas-node-chip.selected');
    expect(popover).not.toBeNull();
    expect(within(popover as HTMLElement).getByText('#1')).toBeInTheDocument();
    expect(screen.getAllByText('10%').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('9 transfers')).toBeInTheDocument();
    expect(within(treasuryRow as HTMLElement).getByText('10%')).toBeInTheDocument();
    expect(within(popover as HTMLElement).getByText('1 route')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy selected wallet address' })).toBeInTheDocument();
  });

  it('keeps filtered cluster search understandable when no members match', () => {
    const { map, labels } = graphFixture();
    render(<AtlasPanel map={map} clusters={map.clusters} labels={labels} />);

    fireEvent.click(clusterPanelButton(/Cluster 1/i));
    fireEvent.change(screen.getByPlaceholderText('Search addresses or labels...'), { target: { value: 'Cluster 1' } });

    expect(screen.getByText('No matching wallets')).toBeInTheDocument();
  });
});
