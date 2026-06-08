'use client';

import { useState } from 'react';

interface User {
  user_id: string;
  role: string;
  workspace_id: string;
  workspace_name: string;
  invited_at: string;
  accepted_at: string | null;
  last_active_at: string | null;
}

interface UserManagementPanelProps {
  users: User[];
}

const ROLE_COLORS: Record<string, string> = {
  admin: '#7c3aed',
  editor: '#2563eb',
  viewer: '#64748b',
};

export function UserManagementPanel({ users: initial }: UserManagementPanelProps) {
  const [search, setSearch] = useState('');

  const filtered = initial.filter(
    (u) => u.user_id.toLowerCase().includes(search.toLowerCase()) ||
           u.workspace_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by user ID or workspace…"
        style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem', marginBottom: '1rem', boxSizing: 'border-box' }}
      />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
            {['User ID', 'Role', 'Workspace', 'Joined', 'Last Active'].map((h) => (
              <th key={h} style={{ padding: '0.625rem 0.75rem', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((u, idx) => (
            <tr key={`${u.user_id}-${idx}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8125rem', color: '#111827' }}>{u.user_id}</td>
              <td style={{ padding: '0.625rem 0.75rem' }}>
                <span style={{
                  padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                  background: `${ROLE_COLORS[u.role] ?? '#94a3b8'}20`,
                  color: ROLE_COLORS[u.role] ?? '#64748b',
                }}>
                  {u.role}
                </span>
              </td>
              <td style={{ padding: '0.625rem 0.75rem', color: '#374151' }}>{u.workspace_name}</td>
              <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
                {u.accepted_at ? new Date(u.accepted_at).toLocaleDateString() : 'Pending'}
              </td>
              <td style={{ padding: '0.625rem 0.75rem', fontSize: '0.75rem', color: '#64748b' }}>
                {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={5} style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
                No users match your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
