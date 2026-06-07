'use client';

import type { GraphNode, GraphEdge } from '@/lib/api';

interface EntityDetailPanelProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  onClose: () => void;
  onExpand: (nodeId: string) => void;
}

/**
 * Slide-in panel showing attributes, relationships, and source connector for a selected graph node.
 *
 * @param node     - The selected node, or null if nothing selected
 * @param edges    - All edges in the current graph (filtered for this node)
 * @param allNodes - All nodes (used to resolve relationship target labels)
 * @param onClose  - Callback when panel is dismissed
 * @param onExpand - Callback to expand the graph from this node
 */
export function EntityDetailPanel({
  node,
  edges,
  allNodes,
  onClose,
  onExpand,
}: EntityDetailPanelProps): React.JSX.Element | null {
  if (!node) return null;

  const nodeById = new Map(allNodes.map(n => [n.id, n]));

  const outgoing = edges.filter(e => e.source === node.id);
  const incoming = edges.filter(e => e.target === node.id);

  const connectorId = node.sourceId.split(':')[0] ?? 'unknown';

  return (
    <aside className="w-80 shrink-0 overflow-y-auto rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <span className="inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 capitalize">
            {node.type}
          </span>
          <h2 className="mt-1 text-base font-semibold text-gray-900 leading-tight break-words">
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </header>

      <section className="mb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Source</p>
        <p className="mt-1 text-sm text-gray-700 font-mono">{connectorId}</p>
        <p className="mt-0.5 text-xs text-gray-400 break-all">{node.sourceId}</p>
      </section>

      {outgoing.length > 0 && (
        <section className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            Outgoing ({outgoing.length})
          </p>
          <ul className="space-y-1.5">
            {outgoing.map(e => {
              const target = nodeById.get(e.target);
              return (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
                    {e.type}
                  </span>
                  <span className="text-gray-700 break-words">{target?.label ?? e.target}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {incoming.length > 0 && (
        <section className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            Incoming ({incoming.length})
          </p>
          <ul className="space-y-1.5">
            {incoming.map(e => {
              const source = nodeById.get(e.source);
              return (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0 rounded bg-purple-50 px-1.5 py-0.5 text-xs text-purple-600">
                    {e.type}
                  </span>
                  <span className="text-gray-700 break-words">{source?.label ?? e.source}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className="text-sm text-gray-400 italic">No relationships in current view.</p>
      )}

      <button
        type="button"
        onClick={() => onExpand(node.id)}
        className="mt-4 w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        Expand from this entity
      </button>
    </aside>
  );
}
