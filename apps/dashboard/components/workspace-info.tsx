'use client';

import { useState } from 'react';

interface WorkspaceInfoData {
  id: string;
  name: string;
  ownerEmail: string;
  plan: string;
  createdAt: string;
}

type Props = {
  workspace: WorkspaceInfoData;
  onSave: (name: string) => Promise<void>;
};

export function WorkspaceInfo({ workspace, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim());
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Workspace ID</label>
          <p className="text-sm font-mono text-gray-700">{workspace.id}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Plan</label>
          <span className="text-sm font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
            {workspace.plan}
          </span>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Owner</label>
          <p className="text-sm text-gray-700">{workspace.ownerEmail}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Created</label>
          <p className="text-sm text-gray-700">{new Date(workspace.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Workspace Name</label>
        {editing ? (
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setEditing(false); setName(workspace.name); setError(null); }}
              className="px-3 py-1.5 border text-sm rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-sm text-gray-700">{workspace.name}</p>
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Edit
            </button>
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
    </div>
  );
}
