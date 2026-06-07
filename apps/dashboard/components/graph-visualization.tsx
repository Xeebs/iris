'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GraphNode, GraphEdge, GraphQueryResult } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphVisualizationProps {
  data: GraphQueryResult;
  selectedNodeId: string | null;
  onSelectNode: (node: GraphNode | null) => void;
  entityTypeFilter: Set<string>;
  relationshipTypeFilter: Set<string>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_TYPE_COLORS: Record<string, string> = {
  contact: '#6366f1',
  company: '#f59e0b',
  deal: '#10b981',
  activity: '#ef4444',
  page: '#8b5cf6',
  issue: '#06b6d4',
  file: '#64748b',
  record: '#ec4899',
};

const NODE_RADIUS = 18;
const WIDTH = 800;
const HEIGHT = 520;
const REPULSION = 6000;
const SPRING_LENGTH = 120;
const SPRING_STRENGTH = 0.05;
const DAMPING = 0.85;
const ITERATIONS = 200;

function getNodeColor(type: string): string {
  return ENTITY_TYPE_COLORS[type] ?? '#94a3b8';
}

// ─── Force simulation ─────────────────────────────────────────────────────────

function runSimulation(nodes: SimNode[], edges: GraphEdge[]): void {
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Initialize positions on a circle
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const radius = Math.min(cx, cy) * 0.6;
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    node.x = cx + radius * Math.cos(angle);
    node.y = cy + radius * Math.sin(angle);
    node.vx = 0;
    node.vy = 0;
  });

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy || 1;
        const dist = Math.sqrt(distSq);
        const force = REPULSION / distSq;
        const fx = (force * dx) / dist;
        const fy = (force * dy) / dist;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Spring attraction along edges
    for (const edge of edges) {
      const src = nodeById.get(edge.source);
      const tgt = nodeById.get(edge.target);
      if (!src || !tgt) continue;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = dist - SPRING_LENGTH;
      const fx = SPRING_STRENGTH * stretch * (dx / dist);
      const fy = SPRING_STRENGTH * stretch * (dy / dist);
      src.vx += fx;
      src.vy += fy;
      tgt.vx -= fx;
      tgt.vy -= fy;
    }

    // Center gravity — weak pull toward viewport center
    for (const node of nodes) {
      node.vx += (cx - node.x) * 0.002;
      node.vy += (cy - node.y) * 0.002;
    }

    // Apply velocity with damping and clamp to viewport
    for (const node of nodes) {
      node.x = Math.max(NODE_RADIUS + 4, Math.min(WIDTH - NODE_RADIUS - 4, node.x + node.vx));
      node.y = Math.max(NODE_RADIUS + 4, Math.min(HEIGHT - NODE_RADIUS - 4, node.y + node.vy));
      node.vx *= DAMPING;
      node.vy *= DAMPING;
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SVG-based force-directed graph visualization.
 * Runs a spring/repulsion simulation once on mount or when data changes.
 *
 * @param data                    - Nodes and edges to visualize
 * @param selectedNodeId          - Currently selected node ID (highlighted)
 * @param onSelectNode            - Callback when a node is clicked
 * @param entityTypeFilter        - Set of entity types to show (empty = show all)
 * @param relationshipTypeFilter  - Set of relationship types to show (empty = show all)
 */
export function GraphVisualization({
  data,
  selectedNodeId,
  onSelectNode,
  entityTypeFilter,
  relationshipTypeFilter,
}: GraphVisualizationProps): React.JSX.Element {
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const simRef = useRef<SimNode[]>([]);

  const filteredNodes = entityTypeFilter.size > 0
    ? data.nodes.filter(n => entityTypeFilter.has(n.type))
    : data.nodes;

  const visibleIds = new Set(filteredNodes.map(n => n.id));

  const filteredEdges = data.edges.filter(e =>
    visibleIds.has(e.source) &&
    visibleIds.has(e.target) &&
    (relationshipTypeFilter.size === 0 || relationshipTypeFilter.has(e.type)),
  );

  useEffect(() => {
    const nodes: SimNode[] = filteredNodes.map(n => ({ ...n, x: 0, y: 0, vx: 0, vy: 0 }));
    runSimulation(nodes, filteredEdges);
    simRef.current = nodes;
    setSimNodes([...nodes]);
  }, [data, entityTypeFilter, relationshipTypeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeById = new Map(simNodes.map(n => [n.id, n]));

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onSelectNode(selectedNodeId === node.id ? null : node);
    },
    [onSelectNode, selectedNodeId],
  );

  if (filteredNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 text-sm">
        No entities match the current filters.
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full h-full"
      role="img"
      aria-label="Entity relationship graph"
    >
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
        </marker>
      </defs>

      {/* Edges */}
      {filteredEdges.map(edge => {
        const src = nodeById.get(edge.source);
        const tgt = nodeById.get(edge.target);
        if (!src || !tgt) return null;

        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offsetX = (dx / dist) * NODE_RADIUS;
        const offsetY = (dy / dist) * NODE_RADIUS;

        const x1 = src.x + offsetX;
        const y1 = src.y + offsetY;
        const x2 = tgt.x - offsetX;
        const y2 = tgt.y - offsetY;

        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;

        const isHighlighted =
          selectedNodeId === edge.source || selectedNodeId === edge.target;

        return (
          <g key={edge.id}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isHighlighted ? '#6366f1' : '#cbd5e1'}
              strokeWidth={isHighlighted ? 2 : 1.5}
              strokeOpacity={isHighlighted ? 1 : 0.6}
              markerEnd="url(#arrowhead)"
            />
            <text
              x={midX}
              y={midY - 4}
              textAnchor="middle"
              fontSize={9}
              fill="#94a3b8"
              className="pointer-events-none select-none"
            >
              {edge.type}
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {simNodes.map(node => {
        const color = getNodeColor(node.type);
        const isSelected = selectedNodeId === node.id;
        const hasEdge =
          filteredEdges.some(e => e.source === node.id || e.target === node.id);

        return (
          <g
            key={node.id}
            transform={`translate(${node.x},${node.y})`}
            onClick={() => handleNodeClick(node)}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-label={`${node.type}: ${node.label}`}
            onKeyDown={e => e.key === 'Enter' && handleNodeClick(node)}
          >
            {isSelected && (
              <circle
                r={NODE_RADIUS + 6}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeOpacity={0.4}
              />
            )}
            <circle
              r={NODE_RADIUS}
              fill={color}
              fillOpacity={hasEdge || isSelected ? 1 : 0.5}
              stroke={isSelected ? '#fff' : 'none'}
              strokeWidth={isSelected ? 2 : 0}
            />
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={600}
              fill="#fff"
              className="pointer-events-none select-none"
            >
              {node.type.slice(0, 2).toUpperCase()}
            </text>
            <text
              y={NODE_RADIUS + 12}
              textAnchor="middle"
              fontSize={10}
              fill="#374151"
              className="pointer-events-none select-none"
            >
              {node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
