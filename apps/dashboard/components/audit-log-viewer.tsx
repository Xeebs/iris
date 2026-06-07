'use client';

import { useEffect, useState } from 'react';

type AuditLog = {
  id: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  createdAt: string;
};

type Props = {
  workspaceId: string;
};

const ACTION_BADGE: Record<string, string> = {
  entity_write: 'bg-blue-100 text-blue-700',
  entity_read: 'bg-gray-100 text-gray-600',
  config_change: 'bg-orange-100 text-orange-700',
  permission_change: 'bg-purple-100 text-purple-700',
  connector_sync: 'bg-green-100 text-green-700',
  dsr_executed: 'bg-red-100 text-red-700',
  login: 'bg-emerald-100 text-emerald-700',
  logout: 'bg-gray-100 text-gray-500',
};

/**
 * Admin audit log viewer with filtering and CSV/JSON export.
 */
export function AuditLogViewer({ workspaceId }: Props) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [actionFilter, setActionFilter] = useState('');

  const fetchLogs = async (appendCursor?: string) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (actionFilter) params.set('action', actionFilter);
    if (appendCursor) params.set('cursor', appendCursor);

    const res = await fetch(`/api/v1/admin/audit-logs?${params.toString()}`);
    const body = await res.json() as {
      data: AuditLog[];
      meta: { nextCursor: string | null; hasMore: boolean };
    };

    if (appendCursor) {
      setLogs((prev) => [...prev, ...(body.data ?? [])]);
    } else {
      setLogs(body.data ?? []);
    }
    setCursor(body.meta?.nextCursor ?? null);
    setHasMore(body.meta?.hasMore ?? false);
    setLoading(false);
  };

  useEffect(() => {
    void fetchLogs();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, workspaceId]);

  const handleExport = (format: 'json' | 'csv') => {
    const url = `/api/v1/admin/audit-logs/export?format=${format}${actionFilter ? `&action=${actionFilter}` : ''}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2 items-center">
          <label className="text-sm text-gray-500">Filter action:</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">All actions</option>
            <option value="entity_write">entity_write</option>
            <option value="entity_read">entity_read</option>
            <option value="config_change">config_change</option>
            <option value="permission_change">permission_change</option>
            <option value="connector_sync">connector_sync</option>
            <option value="dsr_executed">dsr_executed</option>
            <option value="login">login</option>
            <option value="logout">logout</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport('csv')}
            className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => handleExport('json')}
            className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50"
          >
            Export JSON
          </button>
        </div>
      </div>

      {loading && logs.length === 0 ? (
        <p className="text-gray-400 text-sm">Loading audit logs…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Action</th>
                  <th className="py-2 pr-4">Actor</th>
                  <th className="py-2 pr-4">Resource</th>
                  <th className="py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap font-mono text-xs">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_BADGE[log.action] ?? 'bg-gray-100 text-gray-700'}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-700">
                      <span className="font-mono text-xs">{log.actorId ?? log.actorType}</span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600 text-xs">
                      {log.resourceType && (
                        <span>{log.resourceType}{log.resourceId ? `:${log.resourceId.slice(-8)}` : ''}</span>
                      )}
                    </td>
                    <td className="py-2 text-gray-400 text-xs">{log.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              onClick={() => { if (cursor) void fetchLogs(cursor); }}
              className="text-sm text-blue-600 hover:underline"
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}

          {logs.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-8">No audit logs found.</p>
          )}
        </>
      )}
    </div>
  );
}
