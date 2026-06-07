'use client';

import { useState, useEffect, useCallback } from 'react';
import { WorkflowTemplateGallery, type WorkflowTemplate } from '../../components/workflow-template-gallery.js';
import { WorkflowTemplateEditor } from '../../components/workflow-template-editor.js';

const API_BASE = '/api/v1/workflow-templates';

export default function WorkflowsPage() {
  const workspaceId = 'default';
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkflowTemplate | null | false>(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: WorkflowTemplate[] };
      setTemplates(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(
    data: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ) {
    const isEdit = editing && (editing as WorkflowTemplate).id;
    const url = isEdit ? `${API_BASE}/${(editing as WorkflowTemplate).id}` : API_BASE;
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `HTTP ${res.status}`);
    }
    setEditing(false);
    await load();
  }

  async function handleDelete(id: string) {
    const res = await fetch(`${API_BASE}/${id}?workspaceId=${workspaceId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  }

  async function handleToggleActive(id: string, isActive: boolean) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, isActive }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await load();
  }

  return (
    <main className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Pre-configured MCP query sequences for recurring AI agent tasks.
          </p>
        </div>
        {editing === false && (
          <button
            onClick={() => setEditing(null)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
          >
            + New Template
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
      )}

      {editing !== false ? (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            {editing ? `Edit: ${(editing as WorkflowTemplate).templateName}` : 'New Workflow Template'}
          </h2>
          <WorkflowTemplateEditor
            initial={editing as WorkflowTemplate | null}
            workspaceId={workspaceId}
            onSave={handleSave}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <WorkflowTemplateGallery
          templates={templates}
          onSelect={(t) => setEditing(t)}
          onDelete={handleDelete}
          onToggleActive={handleToggleActive}
        />
      )}
    </main>
  );
}
