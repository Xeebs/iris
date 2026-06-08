'use client';

import { useState } from 'react';

export type WorkspaceRole = 'admin' | 'editor' | 'viewer';

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedBy: string | null;
  invitedAt: string;
  acceptedAt: string | null;
}

interface MemberManagementProps {
  members: WorkspaceMember[];
  currentUserId: string;
  onRoleChange?: (userId: string, role: WorkspaceRole) => Promise<void>;
  onRemove?: (userId: string) => Promise<void>;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<WorkspaceRole, string> = {
  admin: '#7c3aed',
  editor: '#2563eb',
  viewer: '#64748b',
};

export function MemberManagement({
  members,
  currentUserId,
  onRoleChange,
  onRemove,
}: MemberManagementProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRoleChange = async (userId: string, role: WorkspaceRole) => {
    if (!onRoleChange) return;
    setLoadingId(userId);
    setError(null);
    try {
      await onRoleChange(userId, role);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setLoadingId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!onRemove) return;
    setLoadingId(userId);
    setError(null);
    try {
      await onRemove(userId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    } finally {
      setLoadingId(null);
    }
  };

  if (members.length === 0) {
    return (
      <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem', textAlign: 'center' }}>
        No team members yet. Invite your team to collaborate.
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      <div role="list" aria-label="Workspace members">
        {members.map((m) => (
          <div
            key={m.id}
            role="listitem"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '0.875rem 0',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            {/* Avatar */}
            <div
              aria-hidden="true"
              style={{
                width: '2.25rem',
                height: '2.25rem',
                borderRadius: '50%',
                background: '#e0e7ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.875rem',
                fontWeight: 700,
                color: '#4f46e5',
                flexShrink: 0,
              }}
            >
              {m.userId.slice(0, 2).toUpperCase()}
            </div>

            {/* User info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 500, fontSize: '0.875rem', color: '#111827' }}>
                {m.userId}
                {m.userId === currentUserId && (
                  <span style={{ marginLeft: '0.375rem', fontSize: '0.75rem', color: '#94a3b8' }}>(you)</span>
                )}
              </p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>
                {m.acceptedAt ? 'Active' : 'Pending invite'}
              </p>
            </div>

            {/* Role badge */}
            <span
              style={{
                display: 'inline-block',
                padding: '0.125rem 0.625rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: `${ROLE_COLORS[m.role]}20`,
                color: ROLE_COLORS[m.role],
              }}
            >
              {ROLE_LABELS[m.role]}
            </span>

            {/* Role selector (hidden for current user) */}
            {m.userId !== currentUserId && onRoleChange && (
              <select
                value={m.role}
                onChange={(e) => { void handleRoleChange(m.userId, e.target.value as WorkspaceRole); }}
                disabled={loadingId === m.userId}
                aria-label={`Change role for ${m.userId}`}
                style={{
                  padding: '0.25rem 0.5rem',
                  border: '1px solid #d1d5db',
                  borderRadius: '0.375rem',
                  fontSize: '0.8125rem',
                  background: 'white',
                  cursor: loadingId === m.userId ? 'not-allowed' : 'pointer',
                }}
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            )}

            {/* Remove button */}
            {m.userId !== currentUserId && onRemove && (
              <button
                onClick={() => { void handleRemove(m.userId); }}
                disabled={loadingId === m.userId}
                aria-label={`Remove ${m.userId}`}
                style={{
                  padding: '0.25rem 0.625rem',
                  background: 'none',
                  border: '1px solid #fecaca',
                  borderRadius: '0.375rem',
                  color: '#dc2626',
                  fontSize: '0.75rem',
                  cursor: loadingId === m.userId ? 'not-allowed' : 'pointer',
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
