'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MemberManagement, type WorkspaceMember, type WorkspaceRole } from '../../../../components/member-management.js';
import { InviteForm } from '../../../../components/invite-form.js';

const API_URL =
  typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1')
    : '/api/v1';

export default function MembersPage({
  params,
}: {
  params: { workspaceId: string };
}): React.JSX.Element {
  const { workspaceId } = params;

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/workspace/members`, {
        headers: { 'x-workspace-id': workspaceId },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: WorkspaceMember[] };
      setMembers(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = useCallback(async (userId: string, role: WorkspaceRole) => {
    const res = await fetch(`${API_URL}/workspace/members/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      credentials: 'include',
      body: JSON.stringify({ userId, role }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message: string } };
      throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    }
    await load();
  }, [workspaceId, load]);

  const handleRoleChange = useCallback(async (userId: string, role: WorkspaceRole) => {
    const res = await fetch(`${API_URL}/workspace/members/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
      credentials: 'include',
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message: string } };
      throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    }
    await load();
  }, [workspaceId, load]);

  const handleRemove = useCallback(async (userId: string) => {
    const res = await fetch(`${API_URL}/workspace/members/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: { 'x-workspace-id': workspaceId },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  }, [workspaceId, load]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Link href="/" className="hover:text-gray-700">Dashboard</Link>
          <span>/</span>
          <Link href={`/settings/${workspaceId}`} className="hover:text-gray-700">Settings</Link>
          <span>/</span>
          <span className="text-gray-700">Members</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{workspaceId}</p>
      </header>

      {/* Role legend */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[
          { role: 'Admin', color: '#7c3aed', desc: 'Full workspace control, manage members' },
          { role: 'Editor', color: '#2563eb', desc: 'Sync connectors, edit glossary & metrics' },
          { role: 'Viewer', color: '#64748b', desc: 'Read-only access, query context' },
        ].map(({ role, color, desc }) => (
          <div key={role} className="bg-white border rounded-lg p-3 text-sm">
            <span className="font-semibold" style={{ color }}>{role}</span>
            <p className="text-gray-500 text-xs mt-0.5">{desc}</p>
          </div>
        ))}
      </div>

      {/* Invite form */}
      <div className="bg-white border rounded-lg p-6 mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Invite Team Member</h2>
        <InviteForm onInvite={handleInvite} />
      </div>

      {/* Member list */}
      <div className="bg-white border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">
            Current Members ({members.length})
          </h2>
          <button
            onClick={() => { void load(); }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded mb-4">{error}</div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading members…</div>
        ) : (
          <MemberManagement
            members={members}
            currentUserId="current-user"
            onRoleChange={handleRoleChange}
            onRemove={handleRemove}
          />
        )}
      </div>
    </main>
  );
}
