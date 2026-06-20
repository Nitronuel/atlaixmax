import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { Copy, Network } from 'lucide-react';
import type { TokenMap } from '../../shared/bubblemaps';
import { formatCompact, formatNumber, formatPercentPoints, shortenAddress } from './format';
import { clusterList, clusterMembers, clusterSupplyBalance, holderSupplyPercent, inferredTotalSupply, walletAddress } from './safe-scan-data';
import { Card, EmptyBlock, SectionHeader, type LabelMap } from './ui';

const atlasPalette = ['#B02CFF', '#18C8FF', '#F97316', '#FFE600', '#12D69E', '#EF4BFF', '#6F8CFF', '#FF4FA3', '#A855F7', '#22D3EE'];
const ATLAS_MIN_ZOOM = 0.25;
const ATLAS_MAX_ZOOM = 4.2;

type HolderNode = {
  id: number;
  rank: number;
  address: string;
  label: string | null;
  tags: string[];
};

type AtlasLink = {
  id: string;
  source: number;
  target: number;
  strength: number;
};

type RenderNode = HolderNode & {
  x: number;
  y: number;
  radius: number;
  color: string;
  componentRoot: number;
  visualGroup: string;
  visualGroupIndex: number | null;
  visualGroupSize: number;
  clustered: boolean;
  degree: number;
};

type RenderLink = AtlasLink & {
  sourceNode: RenderNode;
  targetNode: RenderNode;
};

type ClusterBrowserItem = {
  cluster: unknown | null;
  key: string;
  name: string;
  members: unknown[];
  visibleMembers: unknown[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3 ? normalized.split('').map((char) => `${char}${char}`).join('') : normalized;
  const parsed = Number.parseInt(value, 16);
  if (!Number.isFinite(parsed)) return `rgba(109,127,168,${alpha})`;
  return `rgba(${(parsed >> 16) & 255},${(parsed >> 8) & 255},${parsed & 255},${alpha})`;
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return hash;
}

function detailsTags(details: unknown) {
  const row = details as Record<string, unknown> | null | undefined;
  return [
    row?.is_cex ? 'CEX' : '',
    row?.is_dex ? 'DEX' : '',
    row?.is_contract ? 'Contract' : '',
    row?.is_supernode ? 'Supernode' : ''
  ].filter(Boolean);
}

function readMapHolders(map: TokenMap | null): HolderNode[] {
  const rows = map?.nodes?.top_holders || [];
  return rows.slice(0, 250).map((row, index) => {
    return {
      id: index,
      rank: index + 1,
      address: row.address,
      label: row.address_details?.label || null,
      tags: detailsTags(row.address_details)
    };
  });
}

function readMapLinks(map: TokenMap | null, holders: HolderNode[]): AtlasLink[] {
  const idByAddress = new Map(holders.map((holder) => [holder.address.toLowerCase(), holder.id]));
  return (map?.relationships || []).slice(0, 1200).map((row, index) => {
    const source = idByAddress.get(row.from_address.toLowerCase());
    const target = idByAddress.get(row.to_address.toLowerCase());
    return {
      id: `${row.from_address}-${row.to_address}-${index}`,
      source: Number(source),
      target: Number(target),
      strength: Math.max(1, Math.log10(Math.max(1, row.data.total_transfers)) + Math.log10(Math.max(1, row.data.total_value)) * 0.2)
    };
  }).filter((link) => Number.isFinite(link.source) && Number.isFinite(link.target));
}

function syntheticHolders(clusters: unknown, labels: LabelMap): HolderNode[] {
  return clusterList(clusters).flatMap((cluster, clusterIndex) =>
    clusterMembers(cluster).slice(0, 28).map((member, memberIndex) => {
      const address = walletAddress(member) || `${clusterIndex}-${memberIndex}`;
      return {
        id: clusterIndex * 1000 + memberIndex,
        rank: clusterIndex * 28 + memberIndex + 1,
        address,
        label: labels.get(address.toLowerCase())?.address_details.label || null,
        tags: []
      };
    })
  ).slice(0, 220);
}

function syntheticLinks(clusters: unknown) {
  return clusterList(clusters).flatMap((cluster, clusterIndex) => {
    const members = clusterMembers(cluster).slice(0, 28);
    return members.slice(1).map((_, memberIndex) => ({
      id: `cluster-${clusterIndex}-${memberIndex}`,
      source: clusterIndex * 1000,
      target: clusterIndex * 1000 + memberIndex + 1,
      strength: 1
    }));
  });
}

function buildAtlasLayout(holders: HolderNode[], links: AtlasLink[]) {
  const visibleIds = new Set(holders.map((holder) => holder.id));
  const visibleLinks = links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target));
  const parent = new Map<number, number>();
  const degree = new Map<number, number>();
  holders.forEach((holder) => parent.set(holder.id, holder.id));

  const find = (id: number): number => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const join = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  visibleLinks.forEach((link) => {
    join(link.source, link.target);
    degree.set(link.source, (degree.get(link.source) ?? 0) + link.strength);
    degree.set(link.target, (degree.get(link.target) ?? 0) + link.strength);
  });

  const componentMembers = new Map<number, HolderNode[]>();
  holders.forEach((holder) => {
    const root = find(holder.id);
    const members = componentMembers.get(root) ?? [];
    members.push(holder);
    componentMembers.set(root, members);
  });

  const components = [...componentMembers.entries()]
    .map(([root, members]) => ({ root, members, size: members.length, totalDegree: members.reduce((sum, holder) => sum + (degree.get(holder.id) ?? 0), 0) }))
    .sort((left, right) => (right.size + right.totalDegree * 0.2) - (left.size + left.totalDegree * 0.2));
  const componentRank = new Map(components.map((component, index) => [component.root, index]));
  const clusterCenters = new Map<number, { x: number; y: number }>();

  components.forEach((component, index) => {
    if (component.size <= 1) return;
    if (index === 0) {
      clusterCenters.set(component.root, { x: 650, y: 390 });
      return;
    }
    const angle = -0.78 + index * 1.12;
    const radius = index < 6 ? 285 : 390;
    clusterCenters.set(component.root, { x: 650 + Math.cos(angle) * radius, y: 390 + Math.sin(angle) * radius * 0.74 });
  });

  const nodes: RenderNode[] = holders.map((holder, index) => {
    const root = find(holder.id);
    const component = componentMembers.get(root) ?? [holder];
    const rank = componentRank.get(root) ?? 0;
    const clustered = component.length > 1;
    const seed = Math.abs(hashString(`${holder.address}:${holder.id}`));
    const holderDegree = degree.get(holder.id) ?? 0;
    const contract = holder.tags.some((tag) => /contract|pair|exchange|lp/i.test(tag));
    const nodeRadius = clamp(18 - Math.sqrt(holder.rank) * 0.62 + Math.sqrt(holderDegree) * 0.5 + (contract ? 4 : 0), 5.4, contract ? 24 : 21);
    const center = clustered ? clusterCenters.get(root) ?? { x: 650, y: 390 } : { x: 650, y: 390 };
    const localIndex = component.findIndex((entry) => entry.id === holder.id);
    const angle = clustered ? (localIndex / component.length) * Math.PI * 2 + (seed % 90) / 100 : (index / Math.max(holders.length, 1)) * Math.PI * 2 + (seed % 90) / 100;
    const orbit = clustered ? Math.max(48, Math.sqrt(component.length) * 16 + (seed % 55)) : 300 + (seed % 230);
    return {
      ...holder,
      x: center.x + Math.cos(angle) * orbit,
      y: center.y + Math.sin(angle) * orbit * 0.7,
      radius: nodeRadius,
      color: component.length <= 1 ? '#6D7FA8' : atlasPalette[rank % atlasPalette.length],
      componentRoot: root,
      visualGroup: `${root}:${rank}`,
      visualGroupIndex: component.length <= 1 ? null : rank,
      visualGroupSize: component.length,
      clustered,
      degree: holderDegree
    };
  });

  const simulation = forceSimulation(nodes)
    .force('link', forceLink<RenderNode, AtlasLink>(visibleLinks).id((node) => node.id).distance((link) => {
      const source = link.source as unknown as RenderNode;
      const target = link.target as unknown as RenderNode;
      return source.componentRoot === target.componentRoot ? 54 + Math.max(source.radius, target.radius) * 0.7 : 112;
    }).strength((link) => {
      const source = link.source as unknown as RenderNode;
      const target = link.target as unknown as RenderNode;
      return source.componentRoot === target.componentRoot ? 0.055 : 0.018;
    }))
    .force('charge', forceManyBody<RenderNode>().strength((node) => node.clustered ? -38 - node.radius * 4.5 : -64 - node.radius * 5.2))
    .force('collide', forceCollide<RenderNode>().radius((node) => node.radius + (node.clustered ? 9 : 11)).strength(1).iterations(5))
    .force('x', forceX<RenderNode>((node) => (clusterCenters.get(node.componentRoot)?.x ?? 650)).strength((node) => node.clustered ? 0.045 : 0.018))
    .force('y', forceY<RenderNode>((node) => (clusterCenters.get(node.componentRoot)?.y ?? 390)).strength((node) => node.clustered ? 0.045 : 0.018))
    .force('center', forceCenter(650, 390))
    .stop();

  for (let index = 0; index < 360; index += 1) simulation.tick();

  const bounds = nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x - node.radius),
    maxX: Math.max(acc.maxX, node.x + node.radius),
    minY: Math.min(acc.minY, node.y - node.radius),
    maxY: Math.max(acc.maxY, node.y + node.radius)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const renderLinks = visibleLinks.map((link) => {
    const source = typeof link.source === 'number' ? link.source : (link.source as unknown as RenderNode).id;
    const target = typeof link.target === 'number' ? link.target : (link.target as unknown as RenderNode).id;
    return {
      ...link,
      source,
      target,
      sourceNode: nodeById.get(source),
      targetNode: nodeById.get(target)
    };
  }).filter((link): link is RenderLink => Boolean(link.sourceNode && link.targetNode));

  return { nodes, links: renderLinks, components, bounds };
}

function fitView(nodes: RenderNode[], bounds: { minX: number; maxX: number; minY: number; maxY: number } | null, width = 1200, height = 760) {
  if (!nodes.length || !bounds) return { scale: 1, x: 0, y: 0 };
  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = clamp(Math.min(Math.max(760, width - 170) / graphWidth, Math.max(560, height - 140) / graphHeight), 0.55, 1.35);
  const focus = nodes.filter((node) => node.degree > 0 || node.clustered || node.rank <= 25);
  const centerNodes = focus.length >= 6 ? focus : nodes;
  const weight = centerNodes.reduce((sum, node) => sum + Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0), 0);
  const focusX = centerNodes.reduce((sum, node) => sum + node.x * (Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0)), 0) / weight;
  const focusY = centerNodes.reduce((sum, node) => sum + node.y * (Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0)), 0) / weight;
  return { scale, x: (width / 2) / scale - focusX, y: (height / 2) / scale - focusY };
}

function clusterKey(cluster: unknown, index: number) {
  const row = cluster as Record<string, unknown>;
  return String(row?.id || row?.cluster_id || row?.name || row?.tag || `cluster-${index + 1}`);
}

function buildVisualGroups(clusters: unknown) {
  const groupByAddress = new Map<string, { key: string; color: string; index: number; size: number }>();
  clusterList(clusters).forEach((cluster, index) => {
    const members = clusterMembers(cluster);
    const key = clusterKey(cluster, index);
    const color = atlasPalette[index % atlasPalette.length];
    members.forEach((member) => {
      const address = walletAddress(member).toLowerCase();
      if (address) groupByAddress.set(address, { key, color, index, size: members.length });
    });
  });
  return groupByAddress;
}

function memberShare(member: unknown, totalSupply: number | null) {
  return formatPercentPoints(holderSupplyPercent(member, totalSupply), 'N/A');
}

export function AtlasPanel({ map, clusters, labels }: {
  map: TokenMap | null;
  clusters: unknown;
  labels: LabelMap;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 1200, height: 760 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);
  const [hoveredClusterKey, setHoveredClusterKey] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);

  const mapHolders = useMemo(() => readMapHolders(map), [map]);
  const holders = useMemo(() => mapHolders.length ? mapHolders : syntheticHolders(clusters, labels), [mapHolders, clusters, labels]);
  const links = useMemo(() => {
    const mapLinks = readMapLinks(map, holders);
    return mapLinks.length ? mapLinks : syntheticLinks(clusters);
  }, [map, holders, clusters]);
  const layout = useMemo(() => buildAtlasLayout(holders, links), [holders, links]);
  const clustersRows = useMemo(() => clusterList(clusters), [clusters]);
  const totalSupply = useMemo(() => inferredTotalSupply(clustersRows, holders), [clustersRows, holders]);
  const visualGroups = useMemo(() => buildVisualGroups(clusters), [clusters]);
  const hasRelatedGroups = visualGroups.size > 0;
  const displayNodes = useMemo(() => layout.nodes.map((node) => {
    const group = visualGroups.get(node.address.toLowerCase());
    if (group) {
      return {
        ...node,
        color: group.color,
        visualGroup: group.key,
        visualGroupIndex: group.index,
        visualGroupSize: group.size,
        clustered: true
      };
    }
    return {
      ...node,
      color: hasRelatedGroups ? '#6D7FA8' : node.color,
      visualGroup: hasRelatedGroups ? `atlas-context-${node.id}` : node.visualGroup,
      visualGroupIndex: hasRelatedGroups ? null : node.visualGroupIndex,
      visualGroupSize: hasRelatedGroups ? 1 : node.visualGroupSize,
      clustered: hasRelatedGroups ? false : node.clustered
    };
  }), [hasRelatedGroups, layout.nodes, visualGroups]);
  const displayNodeById = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);
  const displayNodeByAddress = useMemo(() => new Map(displayNodes.map((node) => [node.address.toLowerCase(), node])), [displayNodes]);
  const viewport = useMemo(() => {
    const height = 760;
    const width = clamp((chartSize.width / Math.max(chartSize.height, 1)) * height, 900, 1400);
    return { width, height };
  }, [chartSize.height, chartSize.width]);
  const fitted = useMemo(() => fitView(displayNodes, layout.bounds, viewport.width, viewport.height), [displayNodes, layout.bounds, viewport]);
  const selectedNode = displayNodes.find((node) => node.id === selectedNodeId) || null;
  const hoveredNode = displayNodes.find((node) => node.id === hoveredNodeId) || null;
  const activeNode = selectedNode ?? hoveredNode;
  const activeClusterKey = activeNode ? null : hoveredClusterKey ?? selectedClusterKey;
  const clusterBrowserItems = useMemo<ClusterBrowserItem[]>(() => {
    const items: ClusterBrowserItem[] = clustersRows.map((cluster, index) => {
      const members = clusterMembers(cluster);
      return {
        cluster,
        key: clusterKey(cluster, index),
        name: String((cluster as Record<string, unknown>)?.name || (cluster as Record<string, unknown>)?.tag || `Cluster ${index + 1}`),
        members,
        visibleMembers: members
      };
    });
    const groupedAddresses = new Set<string>();
    clustersRows.forEach((cluster) => {
      clusterMembers(cluster).forEach((member) => {
        const address = walletAddress(member).toLowerCase();
        if (address) groupedAddresses.add(address);
      });
    });
    const unclustered = displayNodes.filter((node) => !groupedAddresses.has(node.address.toLowerCase()));
    if (unclustered.length) {
      items.push({
        cluster: null,
        key: 'unclustered-wallets',
        name: 'Unclustered wallets',
        members: unclustered,
        visibleMembers: unclustered
      });
    }
    return items;
  }, [clustersRows, displayNodes]);
  const visualClusterCount = hasRelatedGroups
    ? new Set(displayNodes.filter((node) => node.visualGroupIndex !== null).map((node) => node.visualGroup)).size
    : layout.components.filter((component) => component.size > 1).length;
  const snapshotTime = map?.metadata.dt_update || map?.metadata.ts_update;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const updateSize = () => setChartSize({ width: Math.max(1, chart.clientWidth), height: Math.max(1, chart.clientHeight) });
    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setView(fitted);
    setSelectedNodeId(null);
    setSelectedClusterKey(null);
    setHoveredClusterKey(null);
    setHoveredNodeId(null);
  }, [fitted.scale, fitted.x, fitted.y]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !layout.nodes.length) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = chart.getBoundingClientRect();
      const pointerX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * viewport.width;
      const pointerY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * viewport.height;
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setView((current) => {
        const scale = clamp(current.scale * factor, ATLAS_MIN_ZOOM, ATLAS_MAX_ZOOM);
        const worldX = (pointerX - current.x) / current.scale;
        const worldY = (pointerY - current.y) / current.scale;
        return { scale, x: pointerX - worldX * scale, y: pointerY - worldY * scale };
      });
    };
    chart.addEventListener('wheel', handleWheel, { passive: false });
    return () => chart.removeEventListener('wheel', handleWheel);
  }, [layout.nodes.length, viewport.height, viewport.width]);

  const setZoom = (scale: number) => setView((current) => ({ ...current, scale: clamp(scale, ATLAS_MIN_ZOOM, ATLAS_MAX_ZOOM) }));
  const resetView = () => {
    setView(fitted);
    setSelectedNodeId(null);
    setSelectedClusterKey(null);
    setHoveredClusterKey(null);
    setHoveredNodeId(null);
  };

  return (
    <Card>
      <SectionHeader
        icon={<Network size={19} />}
        title="Bubblemaps Graph"
        eyebrow="Holder relationships"
        action={snapshotTime ? <span className="snapshot-pill">Snapshot {String(snapshotTime)}</span> : null}
      />
      <div className="atlas-layout">
        <div ref={chartRef} className="atlas-stage">
          {layout.nodes.length ? (
            <>
              <div className="atlas-map-meta">
                <span>Top {formatNumber(layout.nodes.length)} holders</span>
                <span>{formatNumber(visualClusterCount)} clusters</span>
                <span>{formatNumber(layout.links.length)} links</span>
                <span>{Math.round(view.scale * 100)}%</span>
              </div>
              <div className="atlas-controls">
                <button type="button" onClick={() => setZoom(view.scale * 1.18)} aria-label="Zoom in">+</button>
                <button type="button" onClick={() => setZoom(view.scale / 1.18)} aria-label="Zoom out">-</button>
                <button type="button" onClick={resetView} aria-label="Reset graph view">Fit</button>
              </div>
              <svg
                viewBox={`0 0 ${viewport.width} ${viewport.height}`}
                className={`atlas-svg ${dragStart ? 'dragging' : ''}`}
                role="img"
                aria-label="Bubblemaps wallet relationship bubble map"
                onClick={() => setSelectedNodeId(null)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y });
                }}
                onPointerMove={(event) => {
                  if (!dragStart || dragStart.pointerId !== event.pointerId) return;
                  setView((current) => ({ ...current, x: dragStart.viewX + (event.clientX - dragStart.x) / current.scale, y: dragStart.viewY + (event.clientY - dragStart.y) / current.scale }));
                }}
                onPointerUp={(event) => {
                  if (dragStart?.pointerId === event.pointerId) setDragStart(null);
                }}
                onPointerCancel={() => setDragStart(null)}
              >
                <defs>
                  <filter id="atlas-node-glow" x="-60%" y="-60%" width="220%" height="220%">
                    <feGaussianBlur stdDeviation="4.5" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <radialGradient id="atlas-muted-bubble" cx="35%" cy="25%" r="70%">
                    <stop offset="0%" stopColor="#D6E5FF" stopOpacity="0.48" />
                    <stop offset="55%" stopColor="#4C5F89" stopOpacity="0.34" />
                    <stop offset="100%" stopColor="#172036" stopOpacity="0.76" />
                  </radialGradient>
                </defs>
                <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                  {layout.links.map((link) => {
                    const source = displayNodeById.get(link.sourceNode.id) || link.sourceNode;
                    const target = displayNodeById.get(link.targetNode.id) || link.targetNode;
                    const related = activeClusterKey ? source.visualGroup === activeClusterKey && target.visualGroup === activeClusterKey : false;
                    const muted = activeNode ? true : Boolean(activeClusterKey && !related);
                    const midX = (source.x + target.x) / 2;
                    const midY = (source.y + target.y) / 2 - Math.min(34, Math.abs(source.x - target.x) * 0.06);
                    return (
                      <path
                        key={link.id}
                        d={`M ${source.x.toFixed(1)} ${source.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`}
                        fill="none"
                        stroke="#D8E2F4"
                        strokeOpacity={muted ? 0.06 : related ? 0.42 : 0.28}
                        strokeWidth={related ? 1.55 : Math.min(1.45, 0.5 + link.strength * 0.18)}
                        strokeLinecap="round"
                      />
                    );
                  })}
                  {displayNodes.map((node) => {
                    const active = selectedNode?.id === node.id;
                    const hovered = hoveredNodeId === node.id;
                    const related = activeClusterKey ? node.visualGroup === activeClusterKey : false;
                    const focused = active || hovered;
                    const muted = activeNode ? !focused : Boolean(activeClusterKey && !related);
                    const emphasized = focused || related;
                    return (
                      <g
                        key={node.id}
                        className="atlas-node"
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedNodeId(node.id);
                        }}
                      >
                        <circle cx={node.x} cy={node.y} r={node.radius + (focused ? 7 : 6)} fill={node.color} opacity={muted ? 0.015 : focused ? 0.24 : node.clustered ? 0.09 : 0.045} filter="url(#atlas-node-glow)" />
                        <circle cx={node.x} cy={node.y} r={node.radius} fill={node.clustered ? hexToRgba(node.color, 0.48) : 'url(#atlas-muted-bubble)'} fillOpacity={muted ? 0.18 : focused ? 0.88 : node.clustered ? 0.58 : 0.72} stroke={emphasized ? '#FFFFFF' : node.clustered ? node.color : '#556889'} strokeOpacity={muted ? 0.22 : emphasized ? 1 : 0.92} strokeWidth={active ? 3 : hovered ? 2.55 : node.clustered ? 2.1 : 1.55} />
                        <circle cx={node.x - node.radius * 0.28} cy={node.y - node.radius * 0.32} r={Math.max(1.6, node.radius * 0.2)} fill="#FFFFFF" opacity={muted ? 0.03 : focused ? 0.24 : node.clustered ? 0.18 : 0.12} />
                        {(focused || node.rank <= 4) ? <text x={node.x} y={node.y + node.radius + 13}>#{node.rank}</text> : null}
                      </g>
                    );
                  })}
                </g>
              </svg>
              {selectedNode ? (
                <div className="atlas-popover">
                  <div>
                    <small>#{selectedNode.rank} holder</small>
                    <strong>{selectedNode.label || shortenAddress(selectedNode.address)}</strong>
                    <span>{shortenAddress(selectedNode.address)}</span>
                  </div>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(selectedNode.address)} aria-label="Copy selected wallet address">
                    <Copy size={15} />
                  </button>
                  <div className="atlas-popover-stats">
                    <span><b>{formatNumber(selectedNode.degree)}</b> Links</span>
                    <span><b>{selectedNode.clustered ? formatNumber(displayNodes.filter((node) => node.visualGroup === selectedNode.visualGroup).length) : 'Solo'}</b> Group</span>
                    <span><b>{selectedNode.tags[0] || 'wallet'}</b> Type</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyBlock title="Graph unavailable" body="No graph nodes for this token." />
          )}
        </div>
        <div className="cluster-list">
          <div className="cluster-list-head">
            <strong>{clustersRows.length ? 'Cluster List' : 'Address List'}</strong>
            <span>{clustersRows.length ? 'Open a cluster to view wallets' : 'Ranked holders and cluster colors'}</span>
          </div>
          <div className="cluster-list-scroll">
            {clustersRows.length ? clusterBrowserItems.slice(0, 60).map((item, index) => {
              const members = item.members;
              const key = item.key;
              const color = atlasPalette[index % atlasPalette.length];
              const expanded = expandedCluster === key;
              return (
                <div className="cluster-browser-item" key={key}>
                  <button
                    type="button"
                    className={expanded ? 'active' : ''}
                    onClick={() => {
                      setExpandedCluster(expanded ? null : key);
                      setSelectedClusterKey(item.cluster && !expanded ? key : null);
                      setSelectedNodeId(null);
                      setHoveredNodeId(null);
                    }}
                    onMouseEnter={() => {
                      if (item.cluster) setHoveredClusterKey(key);
                    }}
                    onMouseLeave={() => setHoveredClusterKey(null)}
                  >
                    <span className="cluster-dot" style={{ backgroundColor: hexToRgba(color, 0.24), borderColor: color }} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{formatNumber(members.length)} wallets</small>
                    </span>
                    <b>{item.cluster ? `${formatCompact(clusterSupplyBalance([item.cluster]))} tokens` : 'Mixed'}</b>
                    <em>{expanded ? 'Close' : 'View'}</em>
                  </button>
                  {expanded ? (
                    <div className="cluster-members">
                      {item.visibleMembers.slice(0, 80).map((member, memberIndex) => {
                        const address = walletAddress(member);
                        const node = address ? displayNodeByAddress.get(address.toLowerCase()) : null;
                        const label = address ? labels.get(address.toLowerCase()) : undefined;
                        return (
                          <button
                            type="button"
                            className={node && selectedNodeId === node.id ? 'active' : ''}
                            key={`${key}-${address || memberIndex}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (node) {
                                setSelectedClusterKey(null);
                                setSelectedNodeId(node.id);
                              }
                            }}
                            onMouseEnter={() => {
                              if (node) {
                                setHoveredClusterKey(null);
                                setHoveredNodeId(node.id);
                              }
                            }}
                            onMouseLeave={() => setHoveredNodeId(null)}
                          >
                            <span>{node ? `#${node.rank}` : `#${memberIndex + 1}`}</span>
                            <strong>{label?.address_details.label || shortenAddress(address)}</strong>
                            <b>{memberShare(member, totalSupply)}</b>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            }) : displayNodes.slice(0, 80).map((node) => (
              <button className="cluster-row as-button" key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)} onMouseEnter={() => setHoveredNodeId(node.id)} onMouseLeave={() => setHoveredNodeId(null)}>
                <span style={{ background: node.color }} />
                <div>
                  <strong>{node.label || shortenAddress(node.address)}</strong>
                  <small>{node.degree ? `${formatNumber(node.degree)} links` : 'solo'}</small>
                </div>
                <b>#{node.rank}</b>
              </button>
            ))}
          </div>
          <div className="atlas-stats">
            <div><strong>{formatNumber(holders.length)}</strong><span>Nodes</span></div>
            <div><strong>{formatNumber(links.length)}</strong><span>Links</span></div>
            <div><strong>{formatNumber(map?.nodes?.time_nodes?.length || 0)}</strong><span>Time nodes</span></div>
          </div>
        </div>
      </div>
    </Card>
  );
}
