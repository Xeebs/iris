'use client';

import { useState } from 'react';

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  connector_count: number;
  mcp_query_volume: number;
  last_mcp_query_at: string | null;
  status?: string;
}

interface WorkspaceManagementPanelProps {
  workspaces: Workspace[];
  apiBase?: string;
  onRefresh?: () => void;
}

export function WorkspaceManagementPanel({
  workspaces: initial,
  apiBase = '/api/v1',
  onRefresh,
}: WorkspaceManagementPanelProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(initial);
  const [search, setSearch] = useState('');
  const [disabling, setDisabling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = workspaces.filter(
    (w) => w.name.toLowerCase().includes(search.toLowerCase()) || w.id.includes(search),
  );

  const handleDisable = async (id: string) => {
    if (!confirm(`Disable workspace ${id}? This will prevent all users from accessing it.`)) return;
    setDisabling(id);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/admin/system/workspaces/${id}/disable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'admin action' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, status: 'disabled' } : w));
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disable workspace');
    } finally {
      setDisabling(null);
    }
  };

  return (
    <div>
      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or ID…"
        style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            {['Workspace', 'Connectors', 'MCP Queries (30d)', 'Last Active', 'Status', 'Actions'].map((h) => (
              <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((w) => (
            <tr key={w.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '0.625rem 0.75rem' }}>
                <p style={{ margin: 0, fontWeight: 600, color: '#111827' }}>{w.name}</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>{w.id}</p>
              </td>
              <td style={{ padding: '0.625rem 0.75rem', color: '#374151' }}>{w.connector_count}</td>
              <td style={{ padding: '0.625rem 0.75rem', color: '#374151' }}>{w.mcp_query_volume.toLocaleString()}</td>
              <td style={{ padding: '0.625rem 0.75rem', color: '#374151', fontSize: '0.75rem' }}>
                {w.last_mcp_query_at ? new Date(w.last_mcp_query_at).toLocaleDateString() : '—'}
              </td>
              <td style={{ padding: '0.625rem 0.75rem' }}>
                <span style={{
                  padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                  background: w.status === 'disabled' ? '#f1f5f9' : '#f0fdf4',
                  color: w.status === 'disabled' ? '#64748b' : '#16a34a',
                }}>
                  {w.status ?? 'active'}
                </span>
              </td>
              <td style={{ padding: '0.625rem 0.75rem' }}>
                {w.status !== 'disabled' && (
                  <button
                    onClick={() => void handleDisable(w.id)}
                    disabled={disabling === w.id}
                    style={{ padding: '0.25rem 0.625rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {disabling === w.id ? '…' : 'Disable'}
                  </button>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                No workspaces match your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
