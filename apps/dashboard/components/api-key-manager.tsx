'use client';

import { useState } from 'react';

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  key?: string;
}

type Props = {
  apiKeys: ApiKey[];
  onCreate: (name: string, scopes: string[]) => Promise<{ key: string }>;
  onRevoke: (keyId: string) => Promise<void>;
};

const AVAILABLE_SCOPES = ['query:read', 'entities:read', 'glossary:read', 'metrics:read', 'admin'];

export function ApiKeyManager({ apiKeys, onCreate, onRevoke }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['query:read', 'entities:read']);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  function toggleScope(scope: string) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleCreate() {
    if (!newName.trim()) { setError('Key name is required.'); return; }
    if (selectedScopes.length === 0) { setError('Select at least one scope.'); return; }
    setSaving(true);
    setError(null);
    try {
      const result = await onCreate(newName.trim(), selectedScopes);
      setCreatedKey(result.key);
      setNewName('');
      setSelectedScopes(['query:read', 'entities:read']);
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      await onRevoke(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded">{error}</div>
      )}

      {createdKey && (
        <div className="p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-xs font-medium text-green-800 mb-1">
            API key created — copy it now, it won&apos;t be shown again:
          </p>
          <code className="block text-xs font-mono bg-white border rounded px-2 py-1 text-green-900 break-all">
            {createdKey}
          </code>
          <button onClick={() => setCreatedKey(null)} className="mt-2 text-xs text-green-600 hover:text-green-800">
            Dismiss
          </button>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {apiKeys.map((k) => (
          <div key={k.id} className="py-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">{k.name}</p>
              <p className="text-xs font-mono text-gray-400">{k.keyPrefix}••••••••</p>
              <div className="flex gap-1 mt-1 flex-wrap">
                {k.scopes.map((s) => (
                  <span key={s} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="text-right text-xs text-gray-400">
              <p>Created {new Date(k.createdAt).toLocaleDateString()}</p>
              {k.lastUsedAt && <p>Last used {new Date(k.lastUsedAt).toLocaleDateString()}</p>}
            </div>
            <button
              onClick={() => handleRevoke(k.id)}
              disabled={revoking === k.id}
              className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
            >
              {revoking === k.id ? 'Revoking…' : 'Revoke'}
            </button>
          </div>
        ))}
        {apiKeys.length === 0 && <p className="py-4 text-sm text-gray-400 text-center">No API keys yet.</p>}
      </div>

      {!creating ? (
        <button onClick={() => setCreating(true)} className="px-4 py-2 bg-white border text-sm font-medium rounded hover:bg-gray-50">
          + Create API Key
        </button>
      ) : (
        <div className="border rounded p-4 bg-gray-50 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Key Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Claude integration"
              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Scopes</p>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={selectedScopes.includes(s)} onChange={() => toggleScope(s)} className="rounded" />
                  <span className="text-xs text-gray-700">{s}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button onClick={() => { setCreating(false); setError(null); }}
              className="px-3 py-1.5 border text-sm rounded hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
