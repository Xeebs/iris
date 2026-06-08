'use client';

import { useEffect, useState } from 'react';

type StatusCount = { DRAFT: number; PUBLISHED: number; DEPRECATED: number; ARCHIVED: number };
type LifecycleDashboard = { totalByStatus: StatusCount; pendingApprovals: number; deprecatedCount: number; archivedCount: number; atRiskEntities: string[] };
type EntityState = { entityId: string; currentStatus: string; approvalCount: number; lastTransitionAt: string; sunsetDate: string | null; replacementEntityId: string | null };
type HistoryEvent = { id: string; fromStatus: string | null; toStatus: string; reason: string; actor: string; occurredAt: string };

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-zinc-500/20 text-zinc-400 border-zinc-600',
  PUBLISHED: 'bg-green-500/20 text-green-400 border-green-600',
  DEPRECATED: 'bg-yellow-500/20 text-yellow-400 border-yellow-600',
  ARCHIVED: 'bg-zinc-700/50 text-zinc-500 border-zinc-700',
};

export default function EntityLifecyclePage() {
  const [dashboard, setDashboard] = useState<LifecycleDashboard | null>(null);
  const [entities, setEntities] = useState<EntityState[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('PUBLISHED');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/admin/lifecycle/dashboard').then((r) => r.json()),
      fetch(`/api/v1/admin/lifecycle/entities?status=${statusFilter}`).then((r) => r.json()),
    ]).then(([dashRes, entRes]) => {
      setDashboard(dashRes.data ?? null);
      setEntities(entRes.data ?? []);
    }).finally(() => setLoading(false));
  }, [statusFilter]);

  function handleSelectEntity(entityId: string) {
    setSelectedEntity(entityId);
    fetch(`/api/v1/entities/${entityId}/lifecycle`)
      .then((r) => r.json())
      .then((j) => setHistory(j.data?.history ?? []));
  }

  async function handleStatusChange(entityId: string, status: string) {
    const reason = prompt(`Reason for setting to ${status}:`);
    if (!reason) return;
    await fetch(`/api/v1/entities/${entityId}/lifecycle/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, reason, actor: 'dashboard-user', metadata: {} }),
    });
    setEntities((prev) => prev.map((e) => e.entityId === entityId ? { ...e, currentStatus: status } : e));
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Entity Lifecycle Management</h1>
        <p className="text-sm text-zinc-400 mt-1">Track entity status transitions, approvals, and deprecation workflows.</p>
      </div>

      {/* Summary cards */}
      {dashboard && (
        <div className="grid grid-cols-4 gap-4">
          {Object.entries(dashboard.totalByStatus).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg border p-4 text-left transition-colors ${statusFilter === status ? 'border-blue-500/50 bg-blue-500/10' : 'border-zinc-700 bg-zinc-800'}`}
            >
              <p className="text-xs uppercase tracking-wider text-zinc-400">{status}</p>
              <p className="text-2xl font-bold text-white mt-1">{count}</p>
            </button>
          ))}
        </div>
      )}

      {dashboard && (dashboard.pendingApprovals > 0 || dashboard.atRiskEntities.length > 0) && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400 space-y-1">
          {dashboard.pendingApprovals > 0 && <p>{dashboard.pendingApprovals} published entities await approval.</p>}
          {dashboard.atRiskEntities.length > 0 && <p>{dashboard.atRiskEntities.length} at-risk entities detected (stale or unapproved).</p>}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        {/* Entity list */}
        <div className="col-span-2 space-y-2">
          {loading && <div className="text-zinc-500 text-sm">Loading…</div>}
          {entities.map((e) => (
            <div
              key={e.entityId}
              className={`rounded-lg border px-4 py-3 cursor-pointer transition-colors ${selectedEntity === e.entityId ? 'border-blue-500/50 bg-blue-500/10' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700/50'}`}
              onClick={() => handleSelectEntity(e.entityId)}
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[e.currentStatus] ?? ''}`}>{e.currentStatus}</span>
                <span className="font-mono text-sm text-zinc-300">{e.entityId}</span>
                <span className="ml-auto text-xs text-zinc-500">{e.approvalCount} approval{e.approvalCount !== 1 ? 's' : ''}</span>
                <div className="flex gap-1">
                  {e.currentStatus === 'DRAFT' && (
                    <button onClick={(ev) => { ev.stopPropagation(); handleStatusChange(e.entityId, 'PUBLISHED'); }} className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/40">Publish</button>
                  )}
                  {e.currentStatus === 'PUBLISHED' && (
                    <button onClick={(ev) => { ev.stopPropagation(); handleStatusChange(e.entityId, 'DEPRECATED'); }} className="text-xs px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/40">Deprecate</button>
                  )}
                </div>
              </div>
              {e.sunsetDate && (
                <p className="text-xs text-yellow-400 mt-1">Sunset: {new Date(e.sunsetDate).toLocaleDateString()}</p>
              )}
            </div>
          ))}
          {!loading && entities.length === 0 && <p className="text-sm text-zinc-500">No entities found.</p>}
        </div>

        {/* Timeline */}
        <div className="col-span-1">
          {selectedEntity ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-700">
                <span className="text-sm font-medium text-zinc-300">Lifecycle History</span>
              </div>
              <div className="divide-y divide-zinc-800">
                {history.map((h, i) => (
                  <div key={h.id} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {h.fromStatus && <span className="text-xs text-zinc-500">{h.fromStatus}</span>}
                      {h.fromStatus && <span className="text-xs text-zinc-600">→</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${STATUS_COLORS[h.toStatus] ?? ''}`}>{h.toStatus}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">{h.reason}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">by {h.actor} · {new Date(h.occurredAt).toLocaleDateString()}</p>
                  </div>
                ))}
                {history.length === 0 && <p className="px-4 py-4 text-xs text-zinc-500">No history recorded.</p>}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-8 text-center text-sm text-zinc-500">
              Select an entity to view its lifecycle history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
