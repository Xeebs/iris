'use client';

import { useState } from 'react';

export interface TeamMember {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

type Props = {
  members: TeamMember[];
  onRevoke: (id: string) => Promise<void>;
};

const ROLE_STYLES: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  member: 'bg-gray-100 text-gray-600',
};

export function TeamMemberList({ members, onRevoke }: Props) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke(id: string) {
    setRevoking(id);
    setError(null);
    try {
      await onRevoke(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Team Members</h3>
      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded">{error}</div>
      )}
      <div className="divide-y divide-gray-100">
        {members.map((m) => (
          <div key={m.id} className="py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium text-gray-600">
              {m.email[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">{m.email}</p>
              <p className="text-xs text-gray-400">Joined {new Date(m.joinedAt).toLocaleDateString()}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_STYLES[m.role] ?? ''}`}>
              {m.role}
            </span>
            {m.role !== 'owner' && (
              <button
                onClick={() => handleRevoke(m.id)}
                disabled={revoking === m.id}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
              >
                {revoking === m.id ? 'Revoking…' : 'Revoke'}
              </button>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="py-4 text-sm text-gray-400 text-center">No team members yet.</p>
        )}
      </div>
    </div>
  );
}
