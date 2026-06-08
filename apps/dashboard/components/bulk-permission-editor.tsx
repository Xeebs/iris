'use client';

import { useState } from 'react';

type Props = {
  roleIds: string[];
  onApply: (roleIds: string[], permissionName: string, action: 'grant' | 'revoke') => Promise<void>;
};

const COMMON_PERMISSIONS = [
  'read:entities', 'write:entities',
  'read:connectors', 'write:connectors', 'admin:connectors',
  'read:queries', 'write:queries',
  'read:metrics', 'write:metrics',
  'read:users', 'write:users',
  'admin:workspaces',
];

export function BulkPermissionEditor({ roleIds, onApply }: Props) {
  const [selectedPermission, setSelectedPermission] = useState('');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [action, setAction] = useState<'grant' | 'revoke'>('grant');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function toggleRole(roleId: string) {
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((r) => r !== roleId) : [...prev, roleId],
    );
  }

  async function handleApply() {
    if (!selectedPermission || selectedRoles.length === 0) return;
    setLoading(true);
    setResult(null);
    try {
      await onApply(selectedRoles, selectedPermission, action);
      setResult(`${action === 'grant' ? 'Granted' : 'Revoked'} "${selectedPermission}" on ${selectedRoles.length} role(s).`);
      setSelectedRoles([]);
    } catch {
      setResult('Operation failed. Check console for details.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-zinc-300">Bulk Permission Editor</h3>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Select Roles</label>
        <div className="max-h-40 overflow-y-auto space-y-1 rounded border border-zinc-700 p-2">
          {roleIds.map((id) => (
            <label key={id} className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300 hover:text-white">
              <input
                type="checkbox"
                checked={selectedRoles.includes(id)}
                onChange={() => toggleRole(id)}
                className="rounded border-zinc-600 bg-zinc-700"
              />
              <span className="font-mono text-xs">{id}</span>
            </label>
          ))}
          {roleIds.length === 0 && <p className="text-xs text-zinc-600">No roles available.</p>}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-zinc-400">Permission</label>
        <select
          value={selectedPermission}
          onChange={(e) => setSelectedPermission(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="">— select a permission —</option>
          {COMMON_PERMISSIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setAction('grant')}
          className={`flex-1 text-sm py-2 rounded transition-colors ${action === 'grant' ? 'bg-green-600 text-white' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}
        >
          Grant
        </button>
        <button
          onClick={() => setAction('revoke')}
          className={`flex-1 text-sm py-2 rounded transition-colors ${action === 'revoke' ? 'bg-red-600 text-white' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'}`}
        >
          Revoke
        </button>
      </div>

      <button
        onClick={handleApply}
        disabled={loading || !selectedPermission || selectedRoles.length === 0}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white text-sm py-2 rounded transition-colors"
      >
        {loading ? 'Applying…' : `${action === 'grant' ? 'Grant' : 'Revoke'} on ${selectedRoles.length} role(s)`}
      </button>

      {result && (
        <p className={`text-xs px-3 py-2 rounded ${result.includes('failed') ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
          {result}
        </p>
      )}
    </div>
  );
}
