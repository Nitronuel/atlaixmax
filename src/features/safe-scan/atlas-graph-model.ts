import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import type { TokenMap } from '../../shared/bubblemaps';
import { formatCompact, formatNumber, formatPercentPoints } from './format';
import {
  clusterList,
  clusterMembers,
  clusterSupplyPercent,
  holderSupplyPercent,
  supplyPercentField,
  walletAddress,
  walletBalance
} from './safe-scan-data';
import type { LabelMap } from './ui';

export const atlasPalette = ['#EC0AAF', '#FF7A1A', '#C8D20E', '#19C8F2', '#15D59A', '#B02CFF', '#6F8CFF', '#FF4FA3', '#22D3EE', '#FACC15'];
export const ATLAS_MIN_ZOOM = 0.25;
export const ATLAS_MAX_ZOOM = 4.2;

export type HolderNode = {
  id: number;
  rank: number;
  address: string;
  label: string | null;
  tags: string[];
  amount: number | null;
  supplyPercent: number | null;
};

export type AtlasLink = {
  id: string;
  source: number;
  target: number;
  strength: number;
  transferCount: number;
  transferValue: number;
};

export type RenderNode = HolderNode & {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  radius: number;
  color: string;
  visualGroup: string;
  visualGroupIndex: number | null;
  visualGroupShare: number | null;
  clustered: boolean;
  degree: number;
  clusterCenter: { x: number; y: number } | null;
};

export type RenderLink = AtlasLink & {
  sourceNode: RenderNode;
  targetNode: RenderNode;
};

export type VisualGroup = {
  key: string;
  color: string;
  index: number;
  size: number;
  sharePercent: number | null;
  amount: number | null;
};

export type VisualGroupIndex = {
  groupByAddress: Map<string, VisualGroup>;
  groups: VisualGroup[];
};

export type LayoutGroup = VisualGroup & {
  center: { x: number; y: number };
  radius: number;
};

export type NodeDragState = {
  pointerId: number;
  nodeId: number;
  visualGroup: string;
  startX: number;
  startY: number;
  anchorStartX: number | null;
  anchorStartY: number | null;
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function hexToRgba(hex: string, alpha: number) {
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

function supplyRadius(percent: number | null, rank: number, degree: number, tags: string[]) {
  const normalized = percent !== null && Number.isFinite(percent) ? Math.max(0, percent) : 0;
  const supplyWeight = Math.sqrt(normalized) * 8.8;
  const rankWeight = rank <= 5 ? 10 - rank * 0.82 : Math.max(0, 6.8 - Math.sqrt(rank) * 0.38);
  const degreeWeight = Math.sqrt(Math.max(0, degree)) * 0.36;
  const entityWeight = tags.some((tag) => /contract|pair|exchange|lp|cex|dex/i.test(tag)) ? 3.5 : 0;
  return clamp(4.5 + supplyWeight + rankWeight + degreeWeight + entityWeight, 4.8, 42);
}

export function ringLayerCount(size: number) {
  if (size >= 58) return 3;
  if (size >= 20) return 2;
  return 1;
}

export function ringRadiusForGroup(size: number, sharePercent: number | null) {
  const share = Math.max(0, sharePercent ?? 0);
  return clamp(42 + Math.sqrt(size) * 11.5 + Math.sqrt(share) * 12, 64, 190);
}

export function ringRadiusForLayer(baseRadius: number, layers: number, layer: number) {
  if (layers === 1) return baseRadius;
  const innerOffset = Math.min(46, baseRadius * 0.22);
  return baseRadius - innerOffset * (layers - 1 - layer);
}

function contextWalletPosition(index: number, total: number, seed: number) {
  const band = index % 3;
  const bandRadius = [245, 305, 365][band] + (seed % 37);
  const angle = -2.85 + (index / Math.max(1, total)) * Math.PI * 2.45 + ((seed % 41) - 20) / 150;
  return {
    x: 650 + Math.cos(angle) * bandRadius,
    y: 392 + Math.sin(angle) * bandRadius * 0.72
  };
}

export function readMapHolders(map: TokenMap | null): HolderNode[] {
  const rows = map?.nodes?.top_holders || [];
  return rows.slice(0, 250).map((row, index) => ({
    id: index,
    rank: index + 1,
    address: row.address,
    label: row.address_details?.label || null,
    tags: detailsTags(row.address_details),
    amount: Number.isFinite(walletBalance(row)) ? walletBalance(row) : null,
    supplyPercent: typeof supplyPercentField(row) === 'number' ? supplyPercentField(row) as number : null
  }));
}

export function readMapLinks(map: TokenMap | null, holders: HolderNode[]): AtlasLink[] {
  const idByAddress = new Map(holders.map((holder) => [holder.address.toLowerCase(), holder.id]));
  return (map?.relationships || []).slice(0, 1200).map((row, index) => {
    const source = idByAddress.get(row.from_address.toLowerCase());
    const target = idByAddress.get(row.to_address.toLowerCase());
    return {
      id: `${row.from_address}-${row.to_address}-${index}`,
      source: Number(source),
      target: Number(target),
      strength: Math.max(1, Math.log10(Math.max(1, row.data.total_transfers)) + Math.log10(Math.max(1, row.data.total_value)) * 0.2),
      transferCount: row.data.total_transfers,
      transferValue: row.data.total_value
    };
  }).filter((link) => Number.isFinite(link.source) && Number.isFinite(link.target));
}

export function syntheticHolders(clusters: unknown, labels: LabelMap): HolderNode[] {
  return clusterList(clusters).flatMap((cluster, clusterIndex) =>
    clusterMembers(cluster).slice(0, 28).map((member, memberIndex) => {
      const address = walletAddress(member) || `${clusterIndex}-${memberIndex}`;
      return {
        id: clusterIndex * 1000 + memberIndex,
        rank: clusterIndex * 28 + memberIndex + 1,
        address,
        label: labels.get(address.toLowerCase())?.address_details.label || null,
        tags: [],
        amount: Number.isFinite(walletBalance(member)) ? walletBalance(member) : null,
        supplyPercent: typeof supplyPercentField(member) === 'number' ? supplyPercentField(member) as number : null
      };
    })
  ).slice(0, 220);
}

export function syntheticLinks(clusters: unknown) {
  return clusterList(clusters).flatMap((cluster, clusterIndex) => {
    const members = clusterMembers(cluster).slice(0, 28);
    return members.slice(1).map((_, memberIndex) => ({
      id: `cluster-${clusterIndex}-${memberIndex}`,
      source: clusterIndex * 1000,
      target: clusterIndex * 1000 + memberIndex + 1,
      strength: 1,
      transferCount: 1,
      transferValue: 0
    }));
  });
}

export function clusterKey(cluster: unknown, index: number) {
  const row = cluster as Record<string, unknown>;
  return String(row?.id || row?.cluster_id || row?.name || row?.tag || `cluster-${index + 1}`);
}

export function buildVisualGroups(clusters: unknown, totalSupply: number | null): VisualGroupIndex {
  const groupByAddress = new Map<string, VisualGroup>();
  const groups: VisualGroup[] = [];
  clusterList(clusters).forEach((cluster, index) => {
    const members = clusterMembers(cluster);
    const key = clusterKey(cluster, index);
    const color = atlasPalette[index % atlasPalette.length];
    const group: VisualGroup = {
      key,
      color,
      index,
      size: members.length,
      sharePercent: clusterSupplyPercent(cluster, totalSupply),
      amount: Number.isFinite(Number(cluster.amount)) ? Number(cluster.amount) : null
    };
    members.forEach((member) => {
      const address = walletAddress(member).toLowerCase();
      if (address) {
        groupByAddress.set(address, group);
      }
    });
    groups.push(group);
  });
  return { groupByAddress, groups };
}

function buildInitialGroupCenters(groups: VisualGroup[]) {
  const centers = new Map<string, { x: number; y: number }>();
  groups
    .filter((group) => group.size > 0)
    .slice()
    .sort((left, right) => ((right.sharePercent ?? 0) - (left.sharePercent ?? 0)) || right.size - left.size)
    .forEach((group, index) => {
      if (index === 0) {
        centers.set(group.key, { x: 680, y: 415 });
        return;
      }
      const ring = index <= 5 ? 310 : 430;
      const angle = -1.52 + index * 1.08;
      centers.set(group.key, {
        x: 680 + Math.cos(angle) * ring,
        y: 415 + Math.sin(angle) * ring * 0.68
      });
    });
  return centers;
}

export function buildAtlasLayout(holders: HolderNode[], links: AtlasLink[], totalSupply: number | null, visualGroups: VisualGroupIndex) {
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
  const orderedGroups = visualGroups.groups
    .filter((group) => group.size > 0)
    .slice()
    .sort((left, right) => ((right.sharePercent ?? 0) - (left.sharePercent ?? 0)) || right.size - left.size);
  const groupCenters = buildInitialGroupCenters(orderedGroups);

  components.forEach((component, index) => {
    if (component.size <= 1 || orderedGroups.length) return;
    if (index === 0) {
      clusterCenters.set(component.root, { x: 650, y: 390 });
      return;
    }
    const angle = -0.78 + index * 1.12;
    const radius = index < 6 ? 285 : 390;
    clusterCenters.set(component.root, { x: 650 + Math.cos(angle) * radius, y: 390 + Math.sin(angle) * radius * 0.74 });
  });

  const groupMemberOrder = new Map<string, Map<number, number>>();
  orderedGroups.forEach((group) => {
    const ids = holders
      .filter((holder) => visualGroups.groupByAddress.get(holder.address.toLowerCase())?.key === group.key)
      .sort((left, right) => left.rank - right.rank)
      .map((holder) => holder.id);
    groupMemberOrder.set(group.key, new Map(ids.map((id, index) => [id, index])));
  });
  const contextOrder = new Map<number, number>();
  holders.forEach((holder) => {
    const hasVisualGroup = visualGroups.groupByAddress.has(holder.address.toLowerCase());
    const root = find(holder.id);
    const component = componentMembers.get(root) ?? [holder];
    if (!hasVisualGroup && component.length <= 1) contextOrder.set(holder.id, contextOrder.size);
  });

  const nodes: RenderNode[] = holders.map((holder, index) => {
    const root = find(holder.id);
    const component = componentMembers.get(root) ?? [holder];
    const rank = componentRank.get(root) ?? 0;
    const visualGroup = visualGroups.groupByAddress.get(holder.address.toLowerCase()) ?? null;
    const clustered = Boolean(visualGroup) || component.length > 1;
    const seed = Math.abs(hashString(`${holder.address}:${holder.id}`));
    const holderDegree = degree.get(holder.id) ?? 0;
    const supplyPercent = holderSupplyPercent(holder, totalSupply) ?? holder.supplyPercent;
    const groupCenter = visualGroup ? groupCenters.get(visualGroup.key) ?? { x: 650, y: 390 } : null;
    const contextPosition = clustered ? null : contextWalletPosition(contextOrder.get(holder.id) ?? index, Math.max(1, contextOrder.size), seed);
    const center = groupCenter ?? (clustered ? clusterCenters.get(root) ?? { x: 650, y: 390 } : contextPosition ?? { x: 650, y: 390 });
    const localOrder = visualGroup ? groupMemberOrder.get(visualGroup.key)?.get(holder.id) ?? index : component.findIndex((entry) => entry.id === holder.id);
    const localSize = visualGroup?.size ?? component.length;
    const angle = clustered ? (localOrder / Math.max(localSize, 1)) * Math.PI * 2 + (seed % 110) / 140 : (index / Math.max(holders.length, 1)) * Math.PI * 2 + (seed % 90) / 100;
    const share = visualGroup?.sharePercent ?? supplyPercent ?? 0;
    const clusterRadius = visualGroup ? ringRadiusForGroup(localSize, share) : Math.max(48, Math.sqrt(component.length) * 16 + (seed % 55));
    const ringLayer = visualGroup && localSize > 30 ? localOrder % 3 : visualGroup && localSize > 14 ? localOrder % 2 : 0;
    const orbit = visualGroup ? clusterRadius * (0.68 + ringLayer * 0.18) + ((seed % 19) - 9) : clustered ? clusterRadius : (seed % 21) - 10;
    return {
      ...holder,
      x: center.x + Math.cos(angle) * orbit,
      y: center.y + Math.sin(angle) * orbit * 0.7,
      radius: supplyRadius(supplyPercent, holder.rank, holderDegree, holder.tags),
      color: visualGroup?.color ?? (component.length <= 1 ? '#6D7FA8' : atlasPalette[rank % atlasPalette.length]),
      visualGroup: visualGroup?.key ?? `${root}:${rank}`,
      visualGroupIndex: visualGroup?.index ?? (component.length <= 1 ? null : rank),
      visualGroupShare: visualGroup?.sharePercent ?? null,
      clustered,
      degree: holderDegree,
      clusterCenter: groupCenter
    };
  });

  const simulation = forceSimulation(nodes)
    .force('link', forceLink<RenderNode, AtlasLink>(visibleLinks).id((node) => node.id).distance((link) => {
      const source = link.source as unknown as RenderNode;
      const target = link.target as unknown as RenderNode;
      return source.visualGroup === target.visualGroup ? 44 + Math.max(source.radius, target.radius) * 0.86 : 126;
    }).strength((link) => {
      const source = link.source as unknown as RenderNode;
      const target = link.target as unknown as RenderNode;
      return source.visualGroup === target.visualGroup ? 0.06 : 0.015;
    }))
    .force('charge', forceManyBody<RenderNode>().strength((node) => node.clustered ? -28 - node.radius * 3.2 : -30 - node.radius * 2.2))
    .force('collide', forceCollide<RenderNode>().radius((node) => node.radius + (node.clustered ? 3.8 : 10)).strength(0.92).iterations(3))
    .force('context-x', forceX<RenderNode>(650).strength((node) => node.clustered ? 0.01 : 0.038))
    .force('context-y', forceY<RenderNode>(390).strength((node) => node.clustered ? 0.01 : 0.038))
    .force('center', forceCenter(650, 390))
    .stop();
  const warmupTicks = holders.length > 180 ? 180 : holders.length > 100 ? 220 : 280;
  for (let index = 0; index < warmupTicks; index += 1) simulation.tick();

  orderedGroups.forEach((group) => placeGroupRing(nodes, group, groupCenters.get(group.key) ?? { x: 650, y: 390 }));

  const groups = orderedGroups.map((group) => {
    const members = nodes.filter((node) => node.visualGroup === group.key);
    const center = groupCenters.get(group.key) ?? { x: 650, y: 390 };
    const radius = members.reduce((largest, node) => Math.max(largest, Math.hypot(node.x - center.x, node.y - center.y) + node.radius), 0);
    return { ...group, center, radius: clamp(radius + 24, 72, 230) };
  });

  const bounds = boundsForNodes(nodes) ?? { minX: 0, maxX: 1200, minY: 0, maxY: 760 };
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

  return { nodes, links: renderLinks, components, bounds, groups };
}

function placeGroupRing(nodes: RenderNode[], group: VisualGroup, center: { x: number; y: number }) {
  const members = nodes.filter((node) => node.visualGroup === group.key).sort((left, right) => left.rank - right.rank);
  const layers = ringLayerCount(members.length);
  const layerBuckets: RenderNode[][] = Array.from({ length: layers }, () => []);
  members.forEach((node, order) => {
    const outerPriority = order / Math.max(1, members.length - 1);
    const layer = layers === 1 ? 0 : layers === 2 ? (outerPriority < 0.58 ? 1 : 0) : outerPriority < 0.46 ? 2 : outerPriority < 0.82 ? 1 : 0;
    layerBuckets[layer].push(node);
  });

  const baseRadius = ringRadiusForGroup(group.size, group.sharePercent);
  const startAngle = -Math.PI / 2 + (group.index % 3) * 0.24;
  layerBuckets.forEach((bucket, layer) => {
    const layerRadius = ringRadiusForLayer(baseRadius, layers, layer);
    const offset = layer % 2 ? Math.PI / Math.max(3, bucket.length) : 0;
    bucket.forEach((node, bucketIndex) => {
      const seed = Math.abs(hashString(`${node.address}:ring`));
      const angle = startAngle + offset + (bucketIndex / Math.max(1, bucket.length)) * Math.PI * 2 + ((seed % 17) - 8) / 260;
      const jitter = ((seed % 15) - 7) * 0.48;
      node.x = center.x + Math.cos(angle) * (layerRadius + jitter);
      node.y = center.y + Math.sin(angle) * (layerRadius + jitter) * 0.78;
      node.clusterCenter = center;
    });
  });
}

export function decorateContextNodes(nodes: RenderNode[], hasRelatedGroups: boolean, visualGroups: VisualGroupIndex) {
  return nodes.map((node) => {
    if (visualGroups.groupByAddress.has(node.address.toLowerCase())) return node;
    return {
      ...node,
      color: hasRelatedGroups ? '#5A6A92' : node.color,
      visualGroup: hasRelatedGroups ? `atlas-context-${node.id}` : node.visualGroup,
      visualGroupIndex: hasRelatedGroups ? null : node.visualGroupIndex,
      visualGroupShare: hasRelatedGroups ? null : node.visualGroupShare,
      clustered: hasRelatedGroups ? false : node.clustered,
      clusterCenter: hasRelatedGroups ? null : node.clusterCenter
    };
  });
}

export function boundsForNodes(nodes: RenderNode[]) {
  if (!nodes.length) return null;
  return nodes.reduce((acc, node) => ({
    minX: Math.min(acc.minX, node.x - node.radius),
    maxX: Math.max(acc.maxX, node.x + node.radius),
    minY: Math.min(acc.minY, node.y - node.radius),
    maxY: Math.max(acc.maxY, node.y + node.radius)
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

export function groupsForNodes(groups: LayoutGroup[], nodes: RenderNode[], hiddenClusterKeys: Set<string>) {
  return groups.filter((group) => !hiddenClusterKeys.has(group.key)).map((group) => {
    const members = nodes.filter((node) => node.visualGroup === group.key);
    if (!members.length) return group;
    const weight = members.reduce((sum, node) => sum + Math.max(1, node.radius), 0);
    const center = {
      x: members.reduce((sum, node) => sum + node.x * Math.max(1, node.radius), 0) / weight,
      y: members.reduce((sum, node) => sum + node.y * Math.max(1, node.radius), 0) / weight
    };
    const radius = members.reduce((largest, node) => Math.max(largest, Math.hypot(node.x - center.x, node.y - center.y) + node.radius), 0);
    return { ...group, center, radius: clamp(radius + 24, 72, 260) };
  });
}

export function fitView(nodes: RenderNode[], bounds: { minX: number; maxX: number; minY: number; maxY: number } | null, width = 1200, height = 760) {
  if (!nodes.length || !bounds) return { scale: 1, x: 0, y: 0 };
  const focus = nodes.filter((node) => node.degree > 0 || node.clustered || node.rank <= 25);
  const centerNodes = focus.length >= 6 ? focus : nodes;
  const focusBounds = boundsForNodes(centerNodes) ?? bounds;
  const graphWidth = Math.max(1, focusBounds.maxX - focusBounds.minX);
  const graphHeight = Math.max(1, focusBounds.maxY - focusBounds.minY);
  const scale = clamp(Math.min(Math.max(760, width - 130) / (graphWidth + 150), Math.max(560, height - 120) / (graphHeight + 130)), 0.66, 1.48);
  const weight = centerNodes.reduce((sum, node) => sum + Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0), 0);
  const focusX = centerNodes.reduce((sum, node) => sum + node.x * (Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0)), 0) / weight;
  const focusY = centerNodes.reduce((sum, node) => sum + node.y * (Math.max(1, node.degree) + node.radius * 0.4 + (node.rank <= 25 ? 3 : 0)), 0) / weight;
  return { scale, x: width / 2 - focusX * scale, y: height / 2 + 12 - focusY * scale };
}

export function focusViewOnPoint(point: { x: number; y: number }, viewport: { width: number; height: number }, scale: number) {
  const nextScale = clamp(scale, ATLAS_MIN_ZOOM, ATLAS_MAX_ZOOM);
  return {
    scale: nextScale,
    x: viewport.width / 2 - point.x * nextScale,
    y: viewport.height / 2 - point.y * nextScale
  };
}

export function focusViewOnCluster(group: LayoutGroup, viewport: { width: number; height: number }) {
  const scale = clamp(Math.min(viewport.width / (group.radius * 3.2), viewport.height / (group.radius * 2.7)), 0.78, 2.05);
  return focusViewOnPoint(group.center, viewport, scale);
}

export function spokeArrowPoints(node: RenderNode) {
  if (!node.clusterCenter) return null;
  const dx = node.x - node.clusterCenter.x;
  const dy = node.y - node.clusterCenter.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 1) return null;
  const ux = dx / distance;
  const uy = dy / distance;
  const tipX = node.x - ux * (node.radius + 2.5);
  const tipY = node.y - uy * (node.radius + 2.5);
  const length = clamp(node.radius * 0.32, 5.5, 9.5);
  const halfWidth = clamp(node.radius * 0.16, 2.6, 4.6);
  const baseX = tipX - ux * length;
  const baseY = tipY - uy * length;
  const leftX = baseX - uy * halfWidth;
  const leftY = baseY + ux * halfWidth;
  const rightX = baseX + uy * halfWidth;
  const rightY = baseY - ux * halfWidth;
  return `${tipX.toFixed(1)},${tipY.toFixed(1)} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`;
}

export function memberShare(member: unknown, totalSupply: number | null) {
  return formatPercentPoints(holderSupplyPercent(member, totalSupply), 'N/A');
}

export function transferLabel(link: RenderLink) {
  if (link.transferCount > 1) return `${formatCompact(link.transferCount)} transfers`;
  if (link.transferValue > 0) return `${formatCompact(link.transferValue)} moved`;
  return '1 transfer';
}

export function visualClusterCount(nodes: RenderNode[], components: Array<{ size: number }>, hasRelatedGroups: boolean) {
  if (!hasRelatedGroups) return components.filter((component) => component.size > 1).length;
  return new Set(nodes.filter((node) => node.visualGroupIndex !== null).map((node) => node.visualGroup)).size;
}

export function graphMetaLabel(nodeCount: number, clusterCount: number, linkCount: number, zoom: number, hiddenCount: number) {
  const items = [`Top ${formatNumber(nodeCount)} holders`, `${formatNumber(clusterCount)} clusters`, `${formatNumber(linkCount)} links`, `${Math.round(zoom * 100)}%`];
  return hiddenCount ? [...items, `${formatNumber(hiddenCount)} hidden`] : items;
}
