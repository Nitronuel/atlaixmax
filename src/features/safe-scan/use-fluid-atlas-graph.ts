import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import {
  type AtlasLink,
  type LayoutGroup,
  type NodeDragState,
  type RenderLink,
  type RenderNode,
  ringLayerCount,
  ringRadiusForGroup,
  ringRadiusForLayer
} from './atlas-graph-model';

type ViewState = { scale: number; x: number; y: number };
type Viewport = { width: number; height: number };

function clientViewportPosition(svg: SVGSVGElement | null, clientX: number, clientY: number, viewport: Viewport) {
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

function pointerWorldPosition(event: ReactPointerEvent, view: ViewState, viewport: Viewport) {
  const target = event.currentTarget as SVGElement;
  const svg = target instanceof SVGSVGElement ? target : target.ownerSVGElement;
  const pointer = clientViewportPosition(svg, event.clientX, event.clientY, viewport);
  return {
    x: (pointer.x - view.x) / view.scale,
    y: (pointer.y - view.y) / view.scale
  };
}

export function useFluidAtlasGraph({
  displayNodes,
  groups,
  hiddenClusterKeys,
  links,
  lowPower,
  onDragSelect,
  view,
  viewport
}: {
  displayNodes: RenderNode[];
  groups: LayoutGroup[];
  hiddenClusterKeys: Set<string>;
  links: RenderLink[];
  lowPower: boolean;
  onDragSelect: (node: RenderNode) => void;
  view: ViewState;
  viewport: Viewport;
}) {
  const [graphNodes, setGraphNodes] = useState<RenderNode[]>([]);
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);
  const [settling, setSettling] = useState(false);
  const simulationRef = useRef<ReturnType<typeof forceSimulation<RenderNode>> | null>(null);
  const graphNodesRef = useRef<RenderNode[]>([]);
  const nodeByIdRef = useRef<Map<number, RenderNode>>(new Map());
  const groupAnchorsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const dragFrameRef = useRef<number | null>(null);
  const dragStateRef = useRef<NodeDragState | null>(null);
  const pinnedCountRef = useRef(0);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const publishDragFrame = () => {
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      setGraphNodes([...graphNodesRef.current]);
    });
  };

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
      dragStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    simulationRef.current?.stop();
    graphNodesRef.current = displayNodes.map((node) => ({ ...node, fx: null, fy: null, vx: 0, vy: 0 }));
    nodeByIdRef.current = new Map(graphNodesRef.current.map((node) => [node.id, node]));
    setGraphNodes([...graphNodesRef.current]);
    pinnedCountRef.current = 0;
    setSettling(graphNodesRef.current.length > 24);
    groupAnchorsRef.current = new Map(groups.map((group) => [group.key, { ...group.center }]));

    const nodeById = new Map(displayNodes.map((node) => [node.id, node]));
    const activeLinks = links.filter((link) => {
      const source = nodeById.get(link.sourceNode.id) || link.sourceNode;
      const target = nodeById.get(link.targetNode.id) || link.targetNode;
      return !hiddenClusterKeys.has(source.visualGroup) && !hiddenClusterKeys.has(target.visualGroup);
    }).map((link) => ({
      ...link,
      source: link.sourceNode.id,
      target: link.targetNode.id
    }));

    const groupedNodesByKey = new Map<string, RenderNode[]>();
    const orderByGroup = new Map<string, Map<number, number>>();
    graphNodesRef.current.forEach((node) => {
      if (!node.clustered || hiddenClusterKeys.has(node.visualGroup)) return;
      const members = groupedNodesByKey.get(node.visualGroup) ?? [];
      members.push(node);
      groupedNodesByKey.set(node.visualGroup, members);
      const order = orderByGroup.get(node.visualGroup) ?? new Map<number, number>();
      order.set(node.id, order.size);
      orderByGroup.set(node.visualGroup, order);
    });

    const clusterForce = (alpha: number) => {
      groupedNodesByKey.forEach((members, key) => {
        const anchor = groupAnchorsRef.current.get(key);
        if (!anchor) return;
        const weight = members.reduce((sum, node) => sum + Math.max(1, node.radius), 0);
        const centroidX = members.reduce((sum, node) => sum + node.x * Math.max(1, node.radius), 0) / weight;
        const centroidY = members.reduce((sum, node) => sum + node.y * Math.max(1, node.radius), 0) / weight;
        anchor.x += (centroidX - anchor.x) * 0.016;
        anchor.y += (centroidY - anchor.y) * 0.016;

        const groupOrder = orderByGroup.get(key);
        const layers = ringLayerCount(members.length);
        const baseRadius = ringRadiusForGroup(members.length, members.reduce((sum, node) => sum + (node.visualGroupShare ?? 0), 0) / Math.max(1, members.length));
        const startAngle = -Math.PI / 2;
        members.forEach((node) => {
          const order = groupOrder?.get(node.id) ?? node.rank;
          const outerPriority = order / Math.max(1, members.length - 1);
          const layer = layers === 1 ? 0 : layers === 2 ? (outerPriority < 0.58 ? 1 : 0) : outerPriority < 0.46 ? 2 : outerPriority < 0.82 ? 1 : 0;
          const layerRadius = ringRadiusForLayer(baseRadius, layers, layer);
          const offset = layer % 2 ? Math.PI / Math.max(3, members.length) : 0;
          const angle = startAngle + offset + (order / Math.max(1, members.length)) * Math.PI * 2;
          const targetX = anchor.x + Math.cos(angle) * layerRadius;
          const targetY = anchor.y + Math.sin(angle) * layerRadius * 0.78;
          const strength = node.fx === null || node.fx === undefined ? 0.07 : 0.018;
          node.vx = (node.vx ?? 0) + (targetX - node.x) * strength * alpha;
          node.vy = (node.vy ?? 0) + (targetY - node.y) * strength * alpha;
          node.clusterCenter = anchor;
        });
      });
    };

    const simulation = forceSimulation(graphNodesRef.current)
      .alpha(0.8)
      .alphaDecay(0.034)
      .velocityDecay(0.42)
      .force('link', forceLink<RenderNode, AtlasLink>(activeLinks).id((node) => node.id).distance((link) => {
        const source = link.source as unknown as RenderNode;
        const target = link.target as unknown as RenderNode;
        return source.visualGroup === target.visualGroup ? 46 + Math.max(source.radius, target.radius) * 0.86 : 132;
      }).strength((link) => {
        const source = link.source as unknown as RenderNode;
        const target = link.target as unknown as RenderNode;
        return source.visualGroup === target.visualGroup ? 0.045 : 0.012;
      }))
      .force('charge', forceManyBody<RenderNode>().strength((node) => node.clustered ? -18 - node.radius * 2.2 : -24 - node.radius * 1.9))
      .force('collide', forceCollide<RenderNode>().radius((node) => node.radius + (node.clustered ? 4.4 : 11)).strength(lowPower ? 0.72 : 0.9).iterations(lowPower ? 1 : 2))
      .force('cluster', clusterForce)
      .force('context-x', forceX<RenderNode>(650).strength((node) => node.clustered ? 0.004 : 0.052))
      .force('context-y', forceY<RenderNode>(390).strength((node) => node.clustered ? 0.004 : 0.052))
      .force('center', forceCenter(650, 390));

    simulationRef.current = simulation;
    let frame = 0;
    let lastRender = 0;
    const publish = () => {
      frame = 0;
      lastRender = window.performance.now();
      setGraphNodes([...graphNodesRef.current]);
    };
    simulation.on('tick', () => {
      if (frame) return;
      const now = window.performance.now();
      const hasPinnedNode = pinnedCountRef.current > 0;
      const renderDelay = hasPinnedNode ? (lowPower ? 32 : 16) : (lowPower ? 90 : 48);
      if (now - lastRender < renderDelay) return;
      frame = window.requestAnimationFrame(publish);
    });
    simulation.on('end', () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      publish();
      setSettling(false);
    });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      simulation.on('tick', null);
      simulation.on('end', null);
      simulation.stop();
    };
  }, [displayNodes, groups, hiddenClusterKeys, links, lowPower]);

  const startNodeDrag = (event: ReactPointerEvent<SVGGElement>, node: RenderNode) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerWorldPosition(event, view, viewport);
    const simulationNode = nodeByIdRef.current.get(node.id);
    if (simulationNode) {
      simulationNode.fx = point.x;
      simulationNode.fy = point.y;
      simulationNode.x = point.x;
      simulationNode.y = point.y;
      pinnedCountRef.current = 1;
    }
    const anchor = groupAnchorsRef.current.get(node.visualGroup) ?? null;
    const nextDrag = {
      pointerId: event.pointerId,
      nodeId: node.id,
      visualGroup: node.visualGroup,
      startX: point.x,
      startY: point.y,
      anchorStartX: anchor?.x ?? null,
      anchorStartY: anchor?.y ?? null
    };
    onDragSelect(node);
    dragStateRef.current = nextDrag;
    movedRef.current = false;
    suppressClickRef.current = false;
    setNodeDrag(nextDrag);
    setSettling(true);
    publishDragFrame();
    simulationRef.current?.alphaTarget(lowPower ? 0.18 : 0.28).restart();
  };

  const moveNodeDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = pointerWorldPosition(event, view, viewport);
    const simulationNode = nodeByIdRef.current.get(activeDrag.nodeId);
    if (simulationNode) {
      simulationNode.fx = point.x;
      simulationNode.fy = point.y;
      simulationNode.x = point.x;
      simulationNode.y = point.y;
    }
    if (Math.hypot(point.x - activeDrag.startX, point.y - activeDrag.startY) > 2.5) movedRef.current = true;
    const anchor = groupAnchorsRef.current.get(activeDrag.visualGroup);
    if (anchor && activeDrag.anchorStartX !== null && activeDrag.anchorStartY !== null) {
      anchor.x = activeDrag.anchorStartX + (point.x - activeDrag.startX) * 0.72;
      anchor.y = activeDrag.anchorStartY + (point.y - activeDrag.startY) * 0.72;
    }
    publishDragFrame();
  };

  const finishNodeDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const activeDrag = dragStateRef.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const simulationNode = nodeByIdRef.current.get(activeDrag.nodeId);
    if (simulationNode) {
      simulationNode.fx = null;
      simulationNode.fy = null;
    }
    pinnedCountRef.current = 0;
    suppressClickRef.current = movedRef.current;
    dragStateRef.current = null;
    movedRef.current = false;
    setNodeDrag(null);
    publishDragFrame();
    simulationRef.current?.alphaTarget(0);
    simulationRef.current?.alpha(lowPower ? 0.24 : 0.38).restart();
  };

  const consumeSuppressedClick = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  return {
    consumeSuppressedClick,
    graphNodes,
    settling,
    moveNodeDrag,
    nodeDrag,
    finishNodeDrag,
    startNodeDrag
  };
}
