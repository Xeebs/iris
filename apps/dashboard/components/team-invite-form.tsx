'use client';

import { useState } from 'react';

type Role = 'admin' | 'member';

type Props = {
  onInvite: (email: string, role: string) => Promise<void>;
};

export function TeamInviteForm({ onInvite }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError('Email is required.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError('Enter a valid email.'); return; }
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      await onInvite(email.trim(), role);
      setEmail('');
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end">
      <div className="flex-1">
        <label className="block text-xs font-medium text-gray-500 mb-1">Email address</label>
        <input
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSuccess(false); setError(null); }}
          placeholder="colleague@company.com"
          className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Sending…' : 'Invite'}
      </button>
      {error && <p className="text-xs text-red-500 self-center">{error}</p>}
      {success && <p className="text-xs text-green-600 self-center">Invite sent!</p>}
    </form>
  );
}
