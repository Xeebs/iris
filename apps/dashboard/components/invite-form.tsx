'use client';

import { useState } from 'react';
import type { WorkspaceRole } from './member-management.js';

interface InviteFormProps {
  onInvite?: (userId: string, role: WorkspaceRole) => Promise<void>;
}

export function InviteForm({ onInvite }: InviteFormProps) {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('viewer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId.trim()) { setError('User ID is required'); return; }
    if (!onInvite) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await onInvite(userId.trim(), role);
      setSuccess(true);
      setUserId('');
      setRole('viewer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {error && (
        <div role="alert" style={{ padding: '0.625rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.8125rem' }}>
          {error}
        </div>
      )}
      {success && (
        <div role="status" style={{ padding: '0.625rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', color: '#16a34a', fontSize: '0.8125rem' }}>
          Invitation sent successfully.
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: '200px' }}>
          <label htmlFor="invite-userid" style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>
            User ID or Email
          </label>
          <input
            id="invite-userid"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="user@example.com or user-id"
            disabled={loading}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              background: 'white',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="invite-role" style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as WorkspaceRole)}
            disabled={loading}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              fontSize: '0.875rem',
              background: 'white',
            }}
          >
            <option value="viewer">Viewer — can read/query context</option>
            <option value="editor">Editor — can sync connectors and edit glossary</option>
            <option value="admin">Admin — full workspace control</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            type="submit"
            disabled={loading || !userId.trim()}
            style={{
              padding: '0.5rem 1.25rem',
              background: !userId.trim() || loading ? '#94a3b8' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: !userId.trim() || loading ? 'not-allowed' : 'pointer',
            }}
            aria-busy={loading}
          >
            {loading ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </form>
  );
}
