'use client';

import { useState, useCallback, useTransition } from 'react';
import { GraphVisualization } from '@/components/graph-visualization';
import { EntityDetailPanel } from '@/components/entity-detail-panel';
import { queryGraph } from '@/lib/api';
import type { GraphNode, GraphQueryResult } from '@/lib/api';

interface GraphExplorerProps {
  initialData: GraphQueryResult;
  workspaceId: string;
  entityTypes: string[];
  relTypes: string[];
}

/**
 * Client component wrapping the graph visualization and filter controls.
 * Manages filter state, search, and entity expansion requests.
 *
 * @param initialData  - Pre-fetched graph data from the server component
 * @param workspaceId  - Workspace to query
 * @param entityTypes  - All entity types present in the initial graph
 * @param relTypes     - All relationship types present in the initial graph
 */
export function GraphExplorer({
  initialData,
  workspaceId,
  entityTypes,
  relTypes,
}: GraphExplorerProps): React.JSX.Element {
  const [data, setData] = useState<GraphQueryResult>(initialData);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [entityTypeFilter, setEntityTypeFilter] = useState<Set<string>>(new Set());
  const [relTypeFilter, setRelTypeFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allEntityTypes = [...new Set([...entityTypes, ...data.nodes.map(n => n.type)])].sort();
  const allRelTypes = [...new Set([...relTypes, ...data.edges.map(e => e.type)])].sort();

  const refetch = useCallback(
    (overrides: { entityId?: string; entityTypes?: string; search?: string } = {}) => {
      startTransition(async () => {
        setError(null);
        try {
          const opts: import('@/lib/api').GraphQueryOptions = { depth: 2, limit: 150 };
          const entityTypesVal = 'entityTypes' in overrides
            ? overrides.entityTypes
            : (entityTypeFilter.size > 0 ? [...entityTypeFilter].join(',') : undefined);
          const searchVal = 'search' in overrides ? overrides.search : (search || undefined);
          if (entityTypesVal !== undefined) opts.entityTypes = entityTypesVal;
          if (searchVal !== undefined) opts.search = searchVal;
          if (overrides.entityId !== undefined) opts.entityId = overrides.entityId;
          const res = await queryGraph(workspaceId, opts);
          setData(res.data);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to load graph');
        }
      });
    },
    [workspaceId, entityTypeFilter, search],
  );

  const toggleEntityType = useCallback((type: string) => {
    setEntityTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const toggleRelType = useCallback((type: string) => {
    setRelTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }, []);

  const handleExpand = useCallback(
    (nodeId: string) => {
      refetch({ entityId: nodeId });
    },
    [refetch],
  );

  const handleSearch = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      refetch({ search });
    },
    [refetch, search],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search entities…"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isPending ? 'Loading…' : 'Search'}
            </button>
          </form>

          {/* Entity type filters */}
          {allEntityTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-gray-500 self-center mr-1">Types:</span>
              {allEntityTypes.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleEntityType(type)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                    entityTypeFilter.has(type)
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          )}

          {/* Relationship type filters */}
          {allRelTypes.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="text-xs text-gray-500 self-center mr-1">Relations:</span>
              {allRelTypes.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleRelType(type)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    relTypeFilter.has(type)
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          )}

          {(entityTypeFilter.size > 0 || relTypeFilter.size > 0 || search) && (
            <button
              type="button"
              onClick={() => {
                setEntityTypeFilter(new Set());
                setRelTypeFilter(new Set());
                setSearch('');
                refetch({});
              }}
              className="text-xs text-gray-500 hover:text-gray-800 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Graph canvas + detail panel */}
      <div className="flex gap-4">
        <div className="flex-1 rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ minHeight: '520px' }}>
          {isPending ? (
            <div className="flex h-full items-center justify-center text-gray-400 text-sm">
              Loading graph…
            </div>
          ) : (
            <GraphVisualization
              data={data}
              selectedNodeId={selectedNode?.id ?? null}
              onSelectNode={setSelectedNode}
              entityTypeFilter={entityTypeFilter}
              relationshipTypeFilter={relTypeFilter}
            />
          )}
        </div>

        {selectedNode && (
          <EntityDetailPanel
            node={selectedNode}
            edges={data.edges}
            allNodes={data.nodes}
            onClose={() => setSelectedNode(null)}
            onExpand={handleExpand}
          />
        )}
      </div>

      {/* Legend */}
      <div className="text-xs text-gray-400">
        Click a node to view details. Use &ldquo;Expand from this entity&rdquo; to load connected entities.
        Showing {data.nodes.length} nodes, {data.edges.length} edges.
      </div>
    </div>
  );
}
