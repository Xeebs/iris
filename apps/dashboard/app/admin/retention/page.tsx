'use client';

import { useState, useEffect } from 'react';

type ArchiveAction = 'soft_delete' | 'cold_storage' | 'purge';

type RetentionPolicy = {
  id: string;
  entityType: string;
  retentionDays: number;
  archiveAction: ArchiveAction;
  description: string;
  active: boolean;
};

type ArchivedEntity = {
  id: string;
  entityId: string;
  entityType: string;
  reason: string;
  archivedAt: string;
  recoveryWindowDays: number;
  recoveryDeadline: string;
  restorable: boolean;
};

const ACTION_STYLES: Record<ArchiveAction, string> = {
  soft_delete: 'text-yellow-400',
  cold_storage: 'text-blue-400',
  purge: 'text-red-400',
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

function daysUntil(deadline: string): number {
  return (new Date(deadline).getTime() - Date.now()) / 86400000;
}

export default function RetentionPage() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [archived, setArchived] = useState<ArchivedEntity[]>([]);
  const [tab, setTab] = useState<'policies' | 'archived'>('policies');
  const [restoring, setRestoring] = useState<Set<string>>(new Set());

  useEffect(() => {
    void Promise.all([loadPolicies(), loadArchived()]);
  }, []);

  async function loadPolicies() {
    const res = await fetch('/api/v1/admin/retention-policies', { headers: { 'x-workspace-id': WORKSPACE_ID } });
    if (res.ok) { const b = await res.json() as { data: RetentionPolicy[] }; setPolicies(b.data); }
  }

  async function loadArchived() {
    const res = await fetch('/api/v1/admin/retention-policies/archived-entities', { headers: { 'x-workspace-id': WORKSPACE_ID } });
    if (res.ok) { const b = await res.json() as { data: ArchivedEntity[] }; setArchived(b.data); }
  }

  async function restoreEntity(entityId: string) {
    setRestoring((prev) => new Set([...prev, entityId]));
    try {
      await fetch(`/api/v1/admin/retention-policies/archived-entities/${encodeURIComponent(entityId)}/restore`, {
        method: 'POST',
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      await loadArchived();
    } finally {
      setRestoring((prev) => { const s = new Set(prev); s.delete(entityId); return s; });
    }
  }

  const atRisk = archived.filter((e) => e.restorable && daysUntil(e.recoveryDeadline) < 7);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Data Retention & Archival</h1>
        <p className="text-sm text-gray-400 mt-1">Configure retention policies and manage archived entities.</p>
      </header>

      {atRisk.length > 0 && (
        <div className="bg-yellow-950 border border-yellow-700 rounded-lg p-4 mb-6">
          <h2 className="text-sm font-semibold text-yellow-300 mb-1">Recovery Window Warning</h2>
          <p className="text-sm text-yellow-400">{atRisk.length} archived entities expire within 7 days — restore them before the window closes.</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {atRisk.map((e) => (
              <button key={e.entityId} onClick={() => void restoreEntity(e.entityId)} className="text-xs bg-yellow-900 hover:bg-yellow-800 text-yellow-200 border border-yellow-700 rounded px-2 py-1 transition-colors">
                Restore {e.entityId.slice(0, 8)}... ({Math.round(daysUntil(e.recoveryDeadline))}d left)
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex border-b border-gray-700 mb-6">
        {(['policies', 'archived'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}>{t}</button>
        ))}
      </div>

      {tab === 'policies' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                <th className="pb-2 text-left">Entity Type</th>
                <th className="pb-2 text-left">Retention (days)</th>
                <th className="pb-2 text-left">Action</th>
                <th className="pb-2 text-left">Status</th>
                <th className="pb-2 text-left">Description</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.id} className="border-b border-gray-800 hover:bg-gray-900">
                  <td className="py-3 text-gray-200 capitalize">{p.entityType}</td>
                  <td className="py-3 text-white font-medium">{p.retentionDays}</td>
                  <td className={`py-3 font-medium ${ACTION_STYLES[p.archiveAction]}`}>{p.archiveAction.replace('_', ' ')}</td>
                  <td className="py-3">{p.active ? <span className="text-green-400 text-xs">Active</span> : <span className="text-gray-500 text-xs">Disabled</span>}</td>
                  <td className="py-3 text-gray-400 text-xs">{p.description || '—'}</td>
                </tr>
              ))}
              {policies.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-gray-500">No retention policies defined.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'archived' && (
        <div className="space-y-2">
          {archived.map((e) => {
            const daysLeft = daysUntil(e.recoveryDeadline);
            return (
              <div key={e.id} className={`bg-gray-900 border rounded-lg p-4 flex items-center justify-between gap-4 ${!e.restorable ? 'border-gray-800 opacity-60' : daysLeft < 7 ? 'border-yellow-800' : 'border-gray-700'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-200 truncate">{e.entityId}</span>
                    <span className="text-xs text-gray-500 capitalize">{e.entityType}</span>
                  </div>
                  <div className="text-xs text-gray-500">Archived: {new Date(e.archivedAt).toLocaleDateString()} · Reason: {e.reason}</div>
                  {e.restorable && (
                    <div className={`text-xs mt-1 ${daysLeft < 7 ? 'text-yellow-400' : 'text-gray-500'}`}>
                      Recovery deadline: {new Date(e.recoveryDeadline).toLocaleDateString()} ({Math.round(daysLeft)} days)
                    </div>
                  )}
                </div>
                {e.restorable && (
                  <button
                    onClick={() => void restoreEntity(e.entityId)}
                    disabled={restoring.has(e.entityId)}
                    className="shrink-0 text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors disabled:opacity-50"
                  >
                    {restoring.has(e.entityId) ? 'Restoring...' : 'Restore'}
                  </button>
                )}
                {!e.restorable && <span className="shrink-0 text-xs text-gray-600">Expired</span>}
              </div>
            );
          })}
          {archived.length === 0 && <div className="text-center py-10 text-gray-500 text-sm">No archived entities.</div>}
        </div>
      )}
    </div>
  );
}
