'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useEntitySubscription, type EntityUpdate } from '../../lib/use-entity-subscription.js';

interface Entity {
  id: string;
  type: string;
  label: string;
  sourceConnectorId: string;
  lastModified: string;
}

const DEFAULT_WORKSPACE = process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default';

function LiveBadge({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
      <span className={connected ? 'text-green-600' : 'text-gray-400'}>
        {connected ? 'Live' : 'Offline'}
      </span>
    </div>
  );
}

/**
 * Entity list page with real-time update indicators via WebSocket.
 */
export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentUpdates, setRecentUpdates] = useState<EntityUpdate[]>([]);
  const [filterType, setFilterType] = useState('');

  const handleUpdate = useCallback((update: EntityUpdate) => {
    setRecentUpdates((prev) => [update, ...prev].slice(0, 20));
    if (update.changeType === 'deleted') {
      setEntities((prev) => prev.filter((e) => e.id !== update.entityId));
    } else {
      setEntities((prev) =>
        prev.map((e) =>
          e.id === update.entityId ? { ...e, lastModified: update.updatedAt } : e,
        ),
      );
    }
  }, []);

  const { connected } = useEntitySubscription({
    workspaceId: DEFAULT_WORKSPACE,
    entityType: filterType || undefined,
    onUpdate: handleUpdate,
  });

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ workspaceId: DEFAULT_WORKSPACE, limit: '50' });
      if (filterType) params.set('entityType', filterType);
      const res = await fetch(`/api/v1/entities?${params}`);
      if (res.ok) {
        const json = (await res.json()) as { data: Entity[] };
        setEntities(json.data);
      }
    } catch {
      // API unavailable
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { void fetchEntities(); }, [fetchEntities]);

  const entityTypes = [...new Set(entities.map((e) => e.type))].sort();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">← Dashboard</Link>
        <div className="mt-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Entities</h1>
          <LiveBadge connected={connected} />
        </div>
      </header>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void fetchEntities()}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Recent live updates */}
      {recentUpdates.length > 0 && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3">
          <p className="mb-1 text-xs font-medium text-green-700">Recent live updates</p>
          {recentUpdates.slice(0, 3).map((u, i) => (
            <p key={i} className="text-xs text-green-600">
              {u.changeType} {u.entityType} {u.entityId} at {new Date(u.updatedAt).toLocaleTimeString()}
            </p>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}
        </div>
      ) : entities.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-gray-200 text-sm text-gray-400">
          No entities found. Connect a data source to start indexing.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium">Entity ID</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Last Modified</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">
                    <Link href={`/entities/${entity.id}`} className="hover:text-indigo-600">
                      {entity.id.slice(0, 20)}…
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-700">{entity.type}</span>
                  </td>
                  <td className="px-4 py-2 font-medium text-gray-800">{entity.label}</td>
                  <td className="px-4 py-2 text-gray-500">{entity.sourceConnectorId}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">
                    {new Date(entity.lastModified).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
