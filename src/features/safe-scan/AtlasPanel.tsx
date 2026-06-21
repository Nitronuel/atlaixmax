import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Maximize2, Network, Search, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import type { TokenMap } from '../../shared/bubblemaps';
import { formatCompact, formatNumber, formatPercentPoints, shortenAddress } from './format';
import {
  clusterList,
  clusterMembers,
  clusterSupplyBalance,
  clusterSupplyPercent,
  holderSupplyPercent,
  inferredTotalSupply,
  walletAddress
} from './safe-scan-data';
import { Card, EmptyBlock, SectionHeader, type LabelMap } from './ui';
import {
  ATLAS_MAX_ZOOM,
  ATLAS_MIN_ZOOM,
  atlasPalette,
  boundsForNodes,
  buildAtlasLayout,
  buildVisualGroups,
  clamp,
  clusterKey,
  decorateContextNodes,
  fitView,
  focusViewOnCluster,
  focusViewOnPoint,
  graphMetaLabel,
  groupsForNodes,
  hexToRgba,
  memberShare,
  readMapHolders,
  readMapLinks,
  spokeArrowPoints,
  syntheticHolders,
  syntheticLinks,
  transferLabel,
  type LayoutGroup,
  type RenderLink,
  type RenderNode,
  type VisualGroupIndex,
  visualClusterCount
} from './atlas-graph-model';
import { useFluidAtlasGraph } from './use-fluid-atlas-graph';

type ClusterBrowserItem = {
  cluster: unknown | null;
  key: string;
  name: string;
  members: unknown[];
  visibleMembers: unknown[];
  color: string;
  sharePercent: number | null;
  amount: number | null;
  routeCount: number | null;
  internalRouteCount: number | null;
};

function useChartSize(chartRef: React.RefObject<HTMLDivElement | null>) {
  const [chartSize, setChartSize] = useState({ width: 1200, height: 760 });

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return undefined;
    const updateSize = () => setChartSize({ width: Math.max(1, chart.clientWidth), height: Math.max(1, chart.clientHeight) });
    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(chart);
    return () => observer.disconnect();
  }, [chartRef]);

  return chartSize;
}

function devicePrefersLeanGraph() {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency || 8;
  const memory = 'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) : 8;
  return cores <= 4 || memory <= 4;
}

function clusterLabel(cluster: unknown, index: number) {
  const row = cluster as Record<string, unknown> | null;
  return String(row?.name || row?.tag || `Cluster ${index + 1}`);
}

function clientViewportPosition(svg: SVGSVGElement | null, clientX: number, clientY: number, viewport: { width: number; height: number }) {
  if (svg?.createSVGPoint && svg.getScreenCTM) {
    const matrix = svg.getScreenCTM();
    if (matrix) {
      const point = svg.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const transformed = point.matrixTransform(matrix.inverse());
      return { x: transformed.x, y: transformed.y };
    }
  }

  const svgRect = svg?.getBoundingClientRect();
  const parentRect = svg?.parentElement?.getBoundingClientRect();
  const rect = svgRect && svgRect.width && svgRect.height
    ? svgRect
    : parentRect && parentRect.width && parentRect.height
      ? parentRect
      : { left: 0, top: 0, width: viewport.width, height: viewport.height };
  return {
    x: ((clientX - rect.left) / Math.max(rect.width, 1)) * viewport.width,
    y: ((clientY - rect.top) / Math.max(rect.height, 1)) * viewport.height
  };
}

function useClusterBrowserItems({
  clusterLinkStats,
  clustersRows,
  displayNodes,
  labels,
  normalizedAddressQuery,
  totalSupply,
  visualGroups
}: {
  clusterLinkStats: Map<string, { internal: number; touching: number }>;
  clustersRows: unknown[];
  displayNodes: RenderNode[];
  labels: LabelMap;
  normalizedAddressQuery: string;
  totalSupply: number | null;
  visualGroups: VisualGroupIndex;
}) {
  return useMemo<ClusterBrowserItem[]>(() => {
    const items: ClusterBrowserItem[] = clustersRows.map((cluster, index) => {
      const members = clusterMembers(cluster);
      const visibleMembers = normalizedAddressQuery
        ? members.filter((member) => {
          const address = walletAddress(member).toLowerCase();
          const label = address ? labels.get(address)?.address_details.label?.toLowerCase() : '';
          return address.includes(normalizedAddressQuery) || Boolean(label?.includes(normalizedAddressQuery));
        })
        : members;
      const key = clusterKey(cluster, index);
      const visualGroup = visualGroups.groups.find((group) => group.key === key);
      return {
        cluster,
        key,
        name: clusterLabel(cluster, index),
        members,
        visibleMembers,
        color: visualGroup?.color ?? atlasPalette[index % atlasPalette.length],
        sharePercent: visualGroup?.sharePercent ?? clusterSupplyPercent(cluster as Parameters<typeof clusterSupplyPercent>[0], totalSupply),
        amount: visualGroup?.amount ?? clusterSupplyBalance([cluster]),
        routeCount: clusterLinkStats.get(key)?.touching ?? 0,
        internalRouteCount: clusterLinkStats.get(key)?.internal ?? 0
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
      const visibleUnclustered = normalizedAddressQuery
        ? unclustered.filter((node) => node.address.toLowerCase().includes(normalizedAddressQuery) || Boolean(node.label?.toLowerCase().includes(normalizedAddressQuery)))
        : unclustered;
      items.push({
        cluster: null,
        key: 'unclustered-wallets',
        name: 'Unclustered wallets',
        members: unclustered,
        visibleMembers: visibleUnclustered,
        color: '#6D7FA8',
        sharePercent: null,
        amount: null,
        routeCount: null,
        internalRouteCount: null
      });
    }

    return normalizedAddressQuery ? items.filter((item) => item.visibleMembers.length || item.name.toLowerCase().includes(normalizedAddressQuery)) : items;
  }, [clusterLinkStats, clustersRows, displayNodes, labels, normalizedAddressQuery, totalSupply, visualGroups.groups]);
}

function useWheelZoom({
  chartRef,
  layoutNodeCount,
  setView,
  viewport
}: {
  chartRef: React.RefObject<HTMLDivElement | null>;
  layoutNodeCount: number;
  setView: React.Dispatch<React.SetStateAction<{ scale: number; x: number; y: number }>>;
  viewport: { width: number; height: number };
}) {
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !layoutNodeCount) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const wheelDelta = event.deltaY;
      if (!wheelDelta) return;
      const svg = chart.querySelector('svg');
      const pointer = clientViewportPosition(svg, event.clientX, event.clientY, viewport);
      const factor = wheelDelta > 0 ? 0.9 : 1.1;
      setView((current) => zoomViewAt(current, current.scale * factor, pointer));
    };
    chart.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => chart.removeEventListener('wheel', handleWheel, { capture: true });
  }, [chartRef, layoutNodeCount, setView, viewport.height, viewport.width]);
}

function zoomViewAt(
  current: { scale: number; x: number; y: number },
  nextScale: number,
  point: { x: number; y: number }
) {
  const scale = clamp(nextScale, ATLAS_MIN_ZOOM, ATLAS_MAX_ZOOM);
  const worldX = (point.x - current.x) / current.scale;
  const worldY = (point.y - current.y) / current.scale;
  return { scale, x: point.x - worldX * scale, y: point.y - worldY * scale };
}

function groupLinkStats(groups: LayoutGroup[], links: RenderLink[], nodeById: Map<number, RenderNode>) {
  const stats = new Map(groups.map((group) => [group.key, { internal: 0, touching: 0 }]));
  links.forEach((link) => {
    const source = nodeById.get(link.sourceNode.id) || link.sourceNode;
    const target = nodeById.get(link.targetNode.id) || link.targetNode;
    const sourceStats = stats.get(source.visualGroup);
    const targetStats = stats.get(target.visualGroup);
    if (sourceStats) sourceStats.touching += 1;
    if (targetStats && target.visualGroup !== source.visualGroup) targetStats.touching += 1;
    if (source.visualGroup === target.visualGroup && sourceStats) sourceStats.internal += 1;
  });
  return stats;
}

function useGraphPan(view: { scale: number; x: number; y: number }, setView: React.Dispatch<React.SetStateAction<{ scale: number; x: number; y: number }>>, viewport: { width: number; height: number }) {
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);
  return {
    dragStart,
    svgPanHandlers: {
      onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
        if (event.button !== 0) {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = clientViewportPosition(event.currentTarget, event.clientX, event.clientY, viewport);
        setDragStart({ pointerId: event.pointerId, x: point.x, y: point.y, viewX: view.x, viewY: view.y });
      },
      onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
        if (!dragStart || dragStart.pointerId !== event.pointerId) return;
        const point = clientViewportPosition(event.currentTarget, event.clientX, event.clientY, viewport);
        setView((current) => ({
          ...current,
          x: dragStart.viewX + point.x - dragStart.x,
          y: dragStart.viewY + point.y - dragStart.y
        }));
      },
      onPointerUp: (event: React.PointerEvent<SVGSVGElement>) => {
        if (dragStart?.pointerId === event.pointerId) setDragStart(null);
      },
      onPointerCancel: () => setDragStart(null),
      onPointerLeave: () => setDragStart(null)
    }
  };
}

export function AtlasPanel({ map, clusters, labels }: {
  map: TokenMap | null;
  clusters: unknown;
  labels: LabelMap;
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartSize = useChartSize(chartRef);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);
  const [hoveredClusterKey, setHoveredClusterKey] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [clustersGrouped, setClustersGrouped] = useState(true);
  const [addressQuery, setAddressQuery] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [hiddenClusterKeys, setHiddenClusterKeys] = useState<Set<string>>(() => new Set());

  const mapHolders = useMemo(() => readMapHolders(map), [map]);
  const holders = useMemo(() => mapHolders.length ? mapHolders : syntheticHolders(clusters, labels), [mapHolders, clusters, labels]);
  const clustersRows = useMemo(() => clusterList(clusters), [clusters]);
  const totalSupply = useMemo(() => inferredTotalSupply(clustersRows, holders), [clustersRows, holders]);
  const visualGroups = useMemo<VisualGroupIndex>(() => clustersGrouped ? buildVisualGroups(clusters, totalSupply) : { groupByAddress: new Map(), groups: [] }, [clusters, clustersGrouped, totalSupply]);
  const links = useMemo(() => {
    const mapLinks = readMapLinks(map, holders);
    return mapLinks.length ? mapLinks : syntheticLinks(clusters);
  }, [map, holders, clusters]);
  const layout = useMemo(() => buildAtlasLayout(holders, links, totalSupply, visualGroups), [holders, links, totalSupply, visualGroups]);
  const hasRelatedGroups = visualGroups.groups.length > 0;
  const displayNodes = useMemo(() => decorateContextNodes(layout.nodes, hasRelatedGroups, visualGroups), [hasRelatedGroups, layout.nodes, visualGroups]);
  const leanDevice = useMemo(() => devicePrefersLeanGraph(), []);
  const lowPowerGraph = leanDevice || layout.nodes.length > 180 || layout.links.length > 520;
  const viewport = useMemo(() => {
    const height = 760;
    const width = clamp((chartSize.width / Math.max(chartSize.height, 1)) * height, 900, 1400);
    return { width, height };
  }, [chartSize.height, chartSize.width]);

  const graph = useFluidAtlasGraph({
    displayNodes,
    groups: layout.groups,
    hiddenClusterKeys,
    links: layout.links,
    lowPower: lowPowerGraph,
    onDragSelect: (node) => {
      setSelectedNodeId(node.id);
      setSelectedClusterKey(null);
      setHoveredClusterKey(null);
    },
    view,
    viewport
  });

  const renderedNodes = graph.graphNodes.length ? graph.graphNodes : displayNodes;
  const displayNodeById = useMemo(() => new Map(renderedNodes.map((node) => [node.id, node])), [renderedNodes]);
  const displayNodeByAddress = useMemo(() => new Map(renderedNodes.map((node) => [node.address.toLowerCase(), node])), [renderedNodes]);
  const visualGroupSizeByKey = useMemo(() => {
    const sizes = new Map<string, number>();
    displayNodes.forEach((node) => sizes.set(node.visualGroup, (sizes.get(node.visualGroup) ?? 0) + 1));
    return sizes;
  }, [displayNodes]);
  const staticVisibleDisplayNodes = useMemo(() => displayNodes.filter((node) => !hiddenClusterKeys.has(node.visualGroup)), [displayNodes, hiddenClusterKeys]);
  const visibleDisplayNodes = useMemo(() => renderedNodes.filter((node) => !hiddenClusterKeys.has(node.visualGroup)), [hiddenClusterKeys, renderedNodes]);
  const visibleSpokeNodes = useMemo(() => visibleDisplayNodes.filter((node) => node.clusterCenter), [visibleDisplayNodes]);
  const visibleGroups = useMemo(() => groupsForNodes(layout.groups, renderedNodes, hiddenClusterKeys), [hiddenClusterKeys, layout.groups, renderedNodes]);
  const visibleLinks = useMemo(() => layout.links.filter((link) => {
    const source = displayNodeById.get(link.sourceNode.id) || link.sourceNode;
    const target = displayNodeById.get(link.targetNode.id) || link.targetNode;
    return !hiddenClusterKeys.has(source.visualGroup) && !hiddenClusterKeys.has(target.visualGroup);
  }), [displayNodeById, hiddenClusterKeys, layout.links]);
  const linkCountByNodeId = useMemo(() => {
    const counts = new Map<number, number>();
    visibleLinks.forEach((link) => {
      counts.set(link.sourceNode.id, (counts.get(link.sourceNode.id) ?? 0) + 1);
      counts.set(link.targetNode.id, (counts.get(link.targetNode.id) ?? 0) + 1);
    });
    return counts;
  }, [visibleLinks]);
  const fitted = useMemo(() => fitView(staticVisibleDisplayNodes.length ? staticVisibleDisplayNodes : displayNodes, boundsForNodes(staticVisibleDisplayNodes) ?? layout.bounds, viewport.width, viewport.height), [displayNodes, layout.bounds, staticVisibleDisplayNodes, viewport]);

  const selectedNode = selectedNodeId === null ? null : displayNodeById.get(selectedNodeId) ?? null;
  const hoveredNode = hoveredNodeId === null ? null : displayNodeById.get(hoveredNodeId) ?? null;
  const activeNode = selectedNode;
  const activeClusterKey = activeNode ? null : hoveredClusterKey ?? selectedClusterKey;
  const selectedCluster = selectedClusterKey ? visibleGroups.find((group) => group.key === selectedClusterKey) ?? layout.groups.find((group) => group.key === selectedClusterKey) ?? null : null;
  const hoveredCluster = hoveredClusterKey ? visibleGroups.find((group) => group.key === hoveredClusterKey) ?? layout.groups.find((group) => group.key === hoveredClusterKey) ?? null : null;
  const activeCluster = activeNode ? null : hoveredCluster ?? selectedCluster;
  const activeAddress = activeNode?.address.toLowerCase() ?? null;
  const normalizedAddressQuery = addressQuery.trim().toLowerCase();

  const adjacentNodeIds = useMemo(() => {
    if (!activeNode) return new Set<number>();
    const ids = new Set<number>([activeNode.id]);
    visibleLinks.forEach((link) => {
      if (link.sourceNode.id === activeNode.id) ids.add(link.targetNode.id);
      if (link.targetNode.id === activeNode.id) ids.add(link.sourceNode.id);
    });
    return ids;
  }, [activeNode, visibleLinks]);
  const selectedNodeLinks = useMemo(() => selectedNode ? visibleLinks.filter((link) => link.sourceNode.id === selectedNode.id || link.targetNode.id === selectedNode.id) : [], [selectedNode, visibleLinks]);
  const clusterLinkStats = useMemo(() => groupLinkStats(layout.groups, layout.links, displayNodeById), [displayNodeById, layout.groups, layout.links]);
  const activeClusterNodeIds = useMemo(() => {
    if (!activeClusterKey) return new Set<number>();
    const ids = new Set<number>();
    visibleLinks.forEach((link) => {
      const source = displayNodeById.get(link.sourceNode.id) || link.sourceNode;
      const target = displayNodeById.get(link.targetNode.id) || link.targetNode;
      if (source.visualGroup === activeClusterKey || target.visualGroup === activeClusterKey) {
        ids.add(source.id);
        ids.add(target.id);
      }
    });
    return ids;
  }, [activeClusterKey, displayNodeById, visibleLinks]);

  const clusterBrowserItems = useClusterBrowserItems({ clusterLinkStats, clustersRows, displayNodes, labels, normalizedAddressQuery, totalSupply, visualGroups });
  const hoverCardStyle = useMemo<CSSProperties | null>(() => {
    if (!hoveredNode || selectedNode || selectedCluster) return null;
    const screenX = hoveredNode.x * view.scale + view.x;
    const screenY = hoveredNode.y * view.scale + view.y;
    return {
      left: `${(clamp(screenX, 150, viewport.width - 150) / viewport.width) * 100}%`,
      top: `${(clamp(screenY - hoveredNode.radius * view.scale - 14, 48, viewport.height - 64) / viewport.height) * 100}%`,
      '--node-color': hoveredNode.color
    } as CSSProperties;
  }, [hoveredNode, selectedCluster, selectedNode, view.scale, view.x, view.y, viewport.height, viewport.width]);
  const selectedNodeChipStyle = useMemo<CSSProperties | null>(() => {
    if (!selectedNode) return null;
    const screenX = selectedNode.x * view.scale + view.x;
    const screenY = selectedNode.y * view.scale + view.y;
    return {
      left: `${(clamp(screenX, 170, viewport.width - 170) / viewport.width) * 100}%`,
      top: `${(clamp(screenY - selectedNode.radius * view.scale - 16, 52, viewport.height - 64) / viewport.height) * 100}%`,
      '--node-color': selectedNode.color
    } as CSSProperties;
  }, [selectedNode, view.scale, view.x, view.y, viewport.height, viewport.width]);
  const clusterHoverCardStyle = useMemo<CSSProperties | null>(() => {
    if (!hoveredCluster || selectedNode || selectedCluster || hoveredNode) return null;
    const screenX = hoveredCluster.center.x * view.scale + view.x;
    const screenY = hoveredCluster.center.y * view.scale + view.y;
    return {
      left: `${(clamp(screenX, 160, viewport.width - 160) / viewport.width) * 100}%`,
      top: `${(clamp(screenY - hoveredCluster.radius * view.scale - 18, 90, viewport.height - 132) / viewport.height) * 100}%`,
      '--node-color': hoveredCluster.color
    } as CSSProperties;
  }, [hoveredCluster, hoveredNode, selectedCluster, selectedNode, view.scale, view.x, view.y, viewport.height, viewport.width]);

  const metaItems = useMemo(() => {
    if (activeNode) {
      const activeNodeRoutes = linkCountByNodeId.get(activeNode.id) ?? 0;
      const activeNodeGroupSize = activeNode.clustered ? visualGroupSizeByKey.get(activeNode.visualGroup) ?? null : null;
      return [
        `#${activeNode.rank} holder`,
        `${formatPercentPoints(holderSupplyPercent(activeNode, totalSupply) ?? activeNode.supplyPercent, 'N/A')} supply`,
        `${formatNumber(activeNodeRoutes)} routes`,
        activeNodeGroupSize ? `${formatNumber(activeNodeGroupSize)} group wallets` : 'solo wallet',
        `${Math.round(view.scale * 100)}%`
      ];
    }
    if (activeCluster) {
      const activeStats = clusterLinkStats.get(activeCluster.key);
      return [
        `Cluster ${activeCluster.index + 1}`,
        `${formatPercentPoints(activeCluster.sharePercent, 'N/A')} supply`,
        `${formatNumber(activeCluster.size)} wallets`,
        `${formatNumber(activeStats?.touching ?? 0)} routes`,
        `${Math.round(view.scale * 100)}%`
      ];
    }
    return graphMetaLabel(
      visibleDisplayNodes.length,
      visualClusterCount(visibleDisplayNodes, layout.components, hasRelatedGroups),
      visibleLinks.length,
      view.scale,
      hiddenClusterKeys.size
    );
  }, [activeCluster, activeNode, clusterLinkStats, hasRelatedGroups, hiddenClusterKeys.size, layout.components, linkCountByNodeId, totalSupply, view.scale, visibleDisplayNodes, visibleLinks, visualGroupSizeByKey]);
  const snapshotTime = map?.metadata.dt_update || map?.metadata.ts_update;

  useEffect(() => {
    setView(fitted);
    setSelectedNodeId(null);
    setSelectedClusterKey(null);
    setHoveredClusterKey(null);
    setHoveredNodeId(null);
  }, [fitted.scale, fitted.x, fitted.y]);

  useEffect(() => {
    setHiddenClusterKeys(new Set());
  }, [clustersRows]);

  useEffect(() => {
    if (selectedNode?.visualGroupIndex !== null && selectedNode?.visualGroup) setExpandedCluster(selectedNode.visualGroup);
  }, [selectedNode?.visualGroup, selectedNode?.visualGroupIndex]);

  useWheelZoom({ chartRef, layoutNodeCount: layout.nodes.length, setView, viewport });
  const { dragStart, svgPanHandlers } = useGraphPan(view, setView, viewport);

  const resetView = () => {
    setView(fitted);
    setSelectedNodeId(null);
    setSelectedClusterKey(null);
    setHoveredClusterKey(null);
    setHoveredNodeId(null);
  };
  const setZoom = (scale: number) => {
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    setView((current) => zoomViewAt(current, scale, center));
  };
  const focusNode = (node: RenderNode) => {
    setHiddenClusterKeys((current) => {
      if (!current.has(node.visualGroup)) return current;
      const next = new Set(current);
      next.delete(node.visualGroup);
      return next;
    });
    setSelectedNodeId(node.id);
    setSelectedClusterKey(null);
    setHoveredNodeId(null);
    setHoveredClusterKey(null);
    setView((current) => focusViewOnPoint(node, viewport, Math.max(current.scale, 1.55)));
  };
  const revealCluster = (key: string) => {
    setHiddenClusterKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const selectCluster = (key: string) => {
    const group = visibleGroups.find((entry) => entry.key === key) ?? layout.groups.find((entry) => entry.key === key);
    if (!group) return;
    revealCluster(key);
    setSelectedClusterKey(key);
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setHoveredClusterKey(null);
    return group;
  };
  const focusCluster = (key: string) => {
    const group = selectCluster(key);
    if (!group) return;
    setView(focusViewOnCluster(group, viewport));
  };
  const toggleClusterVisibility = (key: string) => {
    const hiding = !hiddenClusterKeys.has(key);
    setHiddenClusterKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (hiding) {
      if (selectedClusterKey === key) setSelectedClusterKey(null);
      if (hoveredClusterKey === key) setHoveredClusterKey(null);
      if (selectedNode?.visualGroup === key) setSelectedNodeId(null);
      if (hoveredNode?.visualGroup === key) setHoveredNodeId(null);
    }
  };

  return (
    <Card className="atlas-card">
      <SectionHeader
        icon={<Network size={19} />}
        title="Bubblemaps Graph"
        eyebrow="Holder relationships"
        action={snapshotTime ? <span className="snapshot-pill">Snapshot {String(snapshotTime)}</span> : null}
      />
      <div className={`atlas-layout ${listCollapsed ? 'list-collapsed' : ''}`}>
        <div ref={chartRef} className="atlas-stage">
          {layout.nodes.length ? (
            <>
              <div className={`atlas-map-meta ${activeNode || activeCluster ? 'active' : ''}`}>
                {metaItems.map((item) => <span key={item}>{item}</span>)}
              </div>
              <div className="atlas-controls">
                <button type="button" onClick={() => setZoom(view.scale * 1.18)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={18} /></button>
                <button type="button" onClick={() => setZoom(view.scale / 1.18)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={18} /></button>
                <button type="button" onClick={resetView} aria-label="Fit graph to view" title="Fit graph"><Maximize2 size={17} /></button>
              </div>
              <svg
                viewBox={`0 0 ${viewport.width} ${viewport.height}`}
                className={`atlas-svg ${dragStart || graph.nodeDrag ? 'dragging' : ''} ${graph.settling ? 'settling' : ''} ${lowPowerGraph ? 'lean' : ''}`}
                role="img"
                aria-label="Bubblemaps wallet relationship bubble map"
                onClick={() => {
                  setSelectedNodeId(null);
                  setSelectedClusterKey(null);
                }}
                {...svgPanHandlers}
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
                  <marker id="atlas-link-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#D8E2F4" opacity="0.56" />
                  </marker>
                  <marker id="atlas-link-arrow-active" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#FFFFFF" opacity="0.9" />
                  </marker>
                </defs>
                <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                  {visibleGroups.map((group) => {
                    const selected = activeClusterKey === group.key || selectedNode?.visualGroup === group.key;
                    const hovered = hoveredClusterKey === group.key;
                    const muted = Boolean((activeClusterKey && activeClusterKey !== group.key) || (activeNode && activeNode.visualGroup !== group.key));
                    return (
                      <g
                        className="atlas-cluster-halo"
                        key={group.key}
                        role="button"
                        tabIndex={0}
                        aria-label={`Focus Cluster ${group.index + 1}`}
                        onMouseEnter={() => setHoveredClusterKey(group.key)}
                        onMouseLeave={() => setHoveredClusterKey(null)}
                        onFocus={() => setHoveredClusterKey(group.key)}
                        onBlur={() => setHoveredClusterKey(null)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            focusCluster(group.key);
                          }
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedCluster(group.key);
                          focusCluster(group.key);
                        }}
                      >
                        <circle cx={group.center.x} cy={group.center.y} r={group.radius} fill={hexToRgba(group.color, selected ? 0.026 : hovered ? 0.018 : 0.004)} stroke={group.color} strokeOpacity={muted ? 0.035 : selected || hovered ? 0.3 : 0.075} strokeWidth={selected || hovered ? 1.8 : 0.8} strokeDasharray="1.5 12" />
                        <circle cx={group.center.x} cy={group.center.y} r={Math.max(4, Math.min(10, Math.sqrt(group.size) * 1.2))} fill={group.color} opacity={muted ? 0.12 : 0.62} />
                        <text className="atlas-cluster-label" x={group.center.x} y={group.center.y - group.radius - 14} fill={group.color} opacity={muted ? 0.14 : selected || hovered || view.scale > 1.05 ? 0.94 : 0.44}>
                          <tspan x={group.center.x}>Cluster {group.index + 1}</tspan>
                          <tspan x={group.center.x} dy="13">{formatPercentPoints(group.sharePercent, `${formatNumber(group.size)} wallets`)}</tspan>
                        </text>
                      </g>
                    );
                  })}
                  {visibleSpokeNodes.map((node) => {
                    const related = activeClusterKey ? node.visualGroup === activeClusterKey : selectedNode?.visualGroup === node.visualGroup;
                    const muted = Boolean((activeClusterKey && !related) || (selectedNode && !adjacentNodeIds.has(node.id) && selectedNode.visualGroup !== node.visualGroup));
                    const arrowPoints = spokeArrowPoints(node);
                    return (
                      <g className="atlas-spoke" key={`spoke-${node.id}`}>
                        <line x1={node.clusterCenter?.x} y1={node.clusterCenter?.y} x2={node.x} y2={node.y} stroke={related ? '#FFFFFF' : node.color} strokeOpacity={muted ? 0.04 : related ? 0.4 : 0.17} strokeWidth={related ? 1.08 : 0.62} strokeLinecap="round" />
                        {arrowPoints && (!lowPowerGraph || related) ? <polygon className="atlas-spoke-arrow" points={arrowPoints} fill={related ? '#FFFFFF' : node.color} opacity={muted ? 0.04 : related ? 0.58 : 0.26} /> : null}
                      </g>
                    );
                  })}
                  {visibleLinks.map((link) => {
                    const source = displayNodeById.get(link.sourceNode.id) || link.sourceNode;
                    const target = displayNodeById.get(link.targetNode.id) || link.targetNode;
                    const sameGroup = source.visualGroup === target.visualGroup;
                    const related = selectedNode ? source.id === selectedNode.id || target.id === selectedNode.id : activeClusterKey ? source.visualGroup === activeClusterKey || target.visualGroup === activeClusterKey : false;
                    const muted = selectedNode ? !related : Boolean(activeClusterKey && !related);
                    const midX = (source.x + target.x) / 2;
                    const midY = (source.y + target.y) / 2 - Math.min(34, Math.abs(source.x - target.x) * 0.06);
                    return (
                      <g className={`atlas-link ${related ? 'active' : ''}`} key={link.id}>
                        <path d={`M ${source.x.toFixed(1)} ${source.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`} fill="none" markerEnd={muted ? undefined : related ? 'url(#atlas-link-arrow-active)' : 'url(#atlas-link-arrow)'} stroke={sameGroup ? source.color : '#D8E2F4'} strokeOpacity={muted ? 0.05 : related ? 0.62 : sameGroup ? 0.28 : 0.24} strokeWidth={related ? 1.6 : Math.min(1.28, 0.42 + link.strength * 0.13)} strokeLinecap="round" />
                        {selectedNode && related ? <text className="atlas-link-label" x={midX} y={midY - 6}>{transferLabel(link)}</text> : null}
                      </g>
                    );
                  })}
                  {visibleDisplayNodes.map((node) => {
                    const active = selectedNode?.id === node.id;
                    const hovered = hoveredNodeId === node.id;
                    const related = activeClusterKey ? node.visualGroup === activeClusterKey : false;
                    const linked = selectedNode ? adjacentNodeIds.has(node.id) : activeClusterKey ? activeClusterNodeIds.has(node.id) : false;
                    const focused = active || hovered;
                    const muted = selectedNode ? !(focused || linked) : Boolean(activeClusterKey && !(related || linked));
                    const emphasized = focused || related || linked;
                    return (
                      <g
                        key={node.id}
                        className="atlas-node"
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.label || shortenAddress(node.address)}, rank ${node.rank}, supply ${formatPercentPoints(holderSupplyPercent(node, totalSupply) ?? node.supplyPercent, 'unknown')}`}
                        onMouseEnter={() => setHoveredNodeId(node.id)}
                        onMouseLeave={() => setHoveredNodeId(null)}
                        onFocus={() => setHoveredNodeId(node.id)}
                        onBlur={() => setHoveredNodeId(null)}
                        onPointerDown={(event) => graph.startNodeDrag(event, node)}
                        onPointerMove={graph.moveNodeDrag}
                        onPointerUp={graph.finishNodeDrag}
                        onPointerCancel={graph.finishNodeDrag}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            focusNode(node);
                          }
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (graph.consumeSuppressedClick()) return;
                          focusNode(node);
                        }}
                      >
                        {emphasized ? <circle className="atlas-node-focus-ring" cx={node.x} cy={node.y} r={node.radius + (focused ? 4.8 : 3.2)} fill="none" stroke="#FFFFFF" strokeOpacity={muted ? 0.08 : focused ? 0.86 : 0.46} strokeWidth={focused ? 2.2 : 1.3} /> : null}
                        {!lowPowerGraph || focused ? <circle className="atlas-node-glow" cx={node.x} cy={node.y} r={node.radius + (focused ? 8 : 5.5)} fill={node.color} opacity={muted ? 0.01 : focused ? 0.2 : node.clustered ? 0.06 : 0.028} filter={lowPowerGraph ? undefined : 'url(#atlas-node-glow)'} /> : null}
                        <circle className="atlas-node-shell" cx={node.x} cy={node.y} r={node.radius} fill={node.clustered ? hexToRgba(node.color, focused ? 0.68 : 0.46) : 'url(#atlas-muted-bubble)'} fillOpacity={muted ? 0.2 : focused ? 0.92 : node.clustered ? 0.76 : 0.7} stroke={focused ? '#FFFFFF' : node.clustered ? node.color : '#657696'} strokeOpacity={muted ? 0.22 : focused ? 1 : node.clustered ? 1 : 0.84} strokeWidth={active ? 3 : hovered ? 2.5 : node.clustered ? 2.25 : 1.55} />
                        <circle className="atlas-node-inner-ring" cx={node.x} cy={node.y} r={Math.max(2.5, node.radius * 0.68)} fill="none" stroke={node.clustered ? '#FFFFFF' : '#BFD0F0'} strokeOpacity={muted ? 0.03 : focused ? 0.24 : node.clustered ? 0.16 : 0.1} strokeWidth={Math.max(0.8, node.radius * 0.05)} />
                        <circle className="atlas-node-highlight" cx={node.x - node.radius * 0.3} cy={node.y - node.radius * 0.34} r={Math.max(1.5, node.radius * 0.18)} fill="#FFFFFF" opacity={muted ? 0.025 : focused ? 0.28 : node.clustered ? 0.15 : 0.11} />
                        {(focused || (view.scale > 1.22 && node.rank <= 8)) ? <text x={node.x} y={node.y + node.radius + 13}>#{node.rank}</text> : null}
                      </g>
                    );
                  })}
                </g>
              </svg>
              {hoveredNode && hoverCardStyle ? (
                <div className="atlas-node-chip" style={hoverCardStyle} role="status">
                  <span className="chip-rank">#{hoveredNode.rank}</span>
                  <strong>{hoveredNode.label || shortenAddress(hoveredNode.address)}</strong>
                  <span className="chip-supply">{formatPercentPoints(holderSupplyPercent(hoveredNode, totalSupply) ?? hoveredNode.supplyPercent, 'N/A')}</span>
                </div>
              ) : null}
              {hoveredCluster && clusterHoverCardStyle ? (
                <div className="atlas-hover-card cluster-preview" style={clusterHoverCardStyle} role="status">
                  <small>Cluster preview</small>
                  <strong>Cluster {hoveredCluster.index + 1}</strong>
                  <span>{formatNumber(hoveredCluster.size)} wallets / {formatPercentPoints(hoveredCluster.sharePercent, 'N/A')} supply</span>
                  <div className="atlas-popover-stats">
                    <span><b>{formatCompact(hoveredCluster.amount)}</b> Tokens</span>
                    <span><b>{formatNumber(clusterLinkStats.get(hoveredCluster.key)?.touching ?? 0)}</b> Routes</span>
                    <span><b>{formatNumber(clusterLinkStats.get(hoveredCluster.key)?.internal ?? 0)}</b> Internal</span>
                  </div>
                </div>
              ) : null}
              {selectedNode && selectedNodeChipStyle ? (
                <div className="atlas-node-chip selected" style={selectedNodeChipStyle} role="status">
                  <span className="chip-rank">#{selectedNode.rank}</span>
                  <strong>{selectedNode.label || shortenAddress(selectedNode.address)}</strong>
                  <span className="chip-supply">{formatPercentPoints(holderSupplyPercent(selectedNode, totalSupply) ?? selectedNode.supplyPercent, 'N/A')}</span>
                  <span className="chip-route">{formatNumber(selectedNodeLinks.length)} route{selectedNodeLinks.length === 1 ? '' : 's'}</span>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(selectedNode.address)} aria-label="Copy selected wallet address">
                    <Copy size={15} />
                  </button>
                </div>
              ) : selectedCluster ? (
                <div className="atlas-popover cluster-summary">
                  <div>
                    <small>Cluster {selectedCluster.index + 1}</small>
                    <strong>{formatPercentPoints(selectedCluster.sharePercent, 'N/A')} supply</strong>
                    <span>{formatNumber(selectedCluster.size)} linked wallets</span>
                  </div>
                  <div className="atlas-popover-stats">
                    <span><b>{formatCompact(selectedCluster.amount)}</b> Tokens</span>
                    <span><b>{formatNumber(clusterLinkStats.get(selectedCluster.key)?.touching ?? 0)}</b> Routes</span>
                    <span><b>{Math.round(view.scale * 100)}%</b> Zoom</span>
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
            <div className="cluster-list-title">
              <strong>Address List</strong>
              <span>{clustersRows.length ? 'Open a cluster to view wallets' : 'Ranked holders and cluster colors'}</span>
            </div>
            <div className="cluster-list-actions">
              <button
                type="button"
                aria-pressed={!listCollapsed}
                aria-label={listCollapsed ? 'Open address list' : 'Collapse address list'}
                title={listCollapsed ? 'Open address list' : 'Collapse address list'}
                onClick={() => setListCollapsed((current) => !current)}
              >
                <Maximize2 size={15} />
                <span>{listCollapsed ? 'List' : 'Graph'}</span>
              </button>
              {clustersRows.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setHiddenClusterKeys(new Set());
                    setClustersGrouped((current) => !current);
                  }}
                >
                  {clustersGrouped ? <EyeOff size={15} /> : <Eye size={15} />}
                  <span>{clustersGrouped ? 'Ungroup Clusters' : 'Group Clusters'}</span>
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Reset list filters"
                title="Reset list filters"
                onClick={() => {
                  setAddressQuery('');
                  setExpandedCluster(null);
                  setHiddenClusterKeys(new Set());
                  resetView();
                }}
              >
                <SlidersHorizontal size={16} />
              </button>
            </div>
            <label className="cluster-search">
              <Search size={16} />
              <input type="search" placeholder="Search addresses or labels..." value={addressQuery} onChange={(event) => setAddressQuery(event.target.value)} />
            </label>
          </div>
          <div className="cluster-list-scroll">
            {clustersRows.length ? clusterBrowserItems.slice(0, 60).map((item, index) => {
              const key = item.key;
              const color = item.color || atlasPalette[index % atlasPalette.length];
              const shareWidth = item.sharePercent !== null ? `${clamp(item.sharePercent, 0, 100)}%` : '0%';
              const expanded = expandedCluster === key;
              const hidden = hiddenClusterKeys.has(key);
              const selected = selectedClusterKey === key || hoveredClusterKey === key || selectedNode?.visualGroup === key;
              return (
                <div className={`cluster-browser-item ${item.cluster ? '' : 'solo'} ${hidden ? 'hidden' : ''}`} key={key}>
                  {item.cluster ? (
                    <button type="button" className="cluster-visibility-toggle" aria-pressed={!hidden} aria-label={`${hidden ? 'Show' : 'Hide'} ${item.name} graph group`} title={`${hidden ? 'Show' : 'Hide'} Cluster ${index + 1}`} onClick={(event) => {
                      event.stopPropagation();
                      toggleClusterVisibility(key);
                    }}>
                      {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`cluster-row-main ${expanded ? 'active' : ''} ${selected ? 'selected' : ''}`}
                    style={{ '--cluster-color': color, '--cluster-share': shareWidth } as CSSProperties}
                    onClick={() => {
                      setExpandedCluster(expanded ? null : key);
                      if (item.cluster && !expanded && !hidden) selectCluster(key);
                      else {
                        setSelectedClusterKey(null);
                        setSelectedNodeId(null);
                        setHoveredNodeId(null);
                      }
                    }}
                    onMouseEnter={() => {
                      if (item.cluster && !hidden) setHoveredClusterKey(key);
                    }}
                    onMouseLeave={() => setHoveredClusterKey(null)}
                    onFocus={() => {
                      if (item.cluster && !hidden) setHoveredClusterKey(key);
                    }}
                    onBlur={() => setHoveredClusterKey(null)}
                  >
                    {!item.cluster ? <EyeOff className="cluster-row-eye muted" size={15} aria-hidden="true" /> : null}
                    <span className="cluster-dot" style={{ backgroundColor: hexToRgba(color, 0.24), borderColor: color }} />
                    <span>
                      <strong>{item.name}</strong>
                      <small>{hidden ? 'Hidden from graph / ' : ''}{formatNumber(item.members.length)} wallets{item.sharePercent !== null ? ` / ${formatPercentPoints(item.sharePercent)}` : ''}</small>
                      <i className="cluster-share-meter" aria-hidden="true" />
                    </span>
                    <b>
                      <span>{item.cluster ? `${formatCompact(item.amount)} tokens` : 'Mixed'}</span>
                      {item.routeCount !== null ? <small>{formatNumber(item.routeCount)} routes{item.internalRouteCount ? ` / ${formatNumber(item.internalRouteCount)} internal` : ''}</small> : null}
                    </b>
                    <em>{hidden ? 'Hidden' : expanded ? 'Close' : 'View'}</em>
                  </button>
                  {expanded ? (
                    <div className="cluster-members">
                      {item.visibleMembers.length ? item.visibleMembers.slice(0, 80).map((member, memberIndex) => {
                        const address = walletAddress(member);
                        const node = address ? displayNodeByAddress.get(address.toLowerCase()) : null;
                        const label = address ? labels.get(address.toLowerCase()) : undefined;
                        const displayAddress = address ? shortenAddress(address) : 'N/A';
                        const memberShareText = node
                          ? formatPercentPoints(holderSupplyPercent(node, totalSupply) ?? node.supplyPercent, memberShare(member, totalSupply))
                          : memberShare(member, totalSupply);
                        return (
                          <button
                            type="button"
                            className={(node && selectedNodeId === node.id) || (address && activeAddress === address.toLowerCase()) ? 'active' : ''}
                            key={`${key}-${address || memberIndex}`}
                            aria-label={`${address || 'Unknown wallet'}, ${memberShareText}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (node) focusNode(node);
                            }}
                            onMouseEnter={() => {
                              if (node && !hidden) {
                                setHoveredClusterKey(null);
                                setHoveredNodeId(node.id);
                              }
                            }}
                            onMouseLeave={() => setHoveredNodeId(null)}
                          >
                            <span>{node ? `#${node.rank}` : `#${memberIndex + 1}`}</span>
                            <span className="cluster-member-wallet" title={address || undefined}>
                              <strong>{displayAddress}</strong>
                              {label?.address_details.label ? <small>{label.address_details.label}</small> : null}
                            </span>
                            <b className="cluster-member-share">{memberShareText}</b>
                          </button>
                        );
                      }) : <div className="cluster-members-empty">No matching wallets</div>}
                    </div>
                  ) : null}
                </div>
              );
            }) : displayNodes.slice(0, 80).map((node) => (
              <button className="cluster-row as-button" key={node.id} type="button" onClick={() => focusNode(node)} onMouseEnter={() => setHoveredNodeId(node.id)} onMouseLeave={() => setHoveredNodeId(null)}>
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
