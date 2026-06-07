'use client';

import { useState } from 'react';

type TriggerType = 'manual' | 'calendar' | 'entity_change';
type ResponseFormat = 'text' | 'json' | 'markdown';

interface McpCall {
  tool: string;
  params: Record<string, unknown>;
}

interface WorkflowTemplate {
  id: string;
  workspaceId: string;
  templateName: string;
  description: string;
  triggerType: TriggerType;
  triggerConfig: { cron?: string; watchEntityTypes?: string[] };
  mcpCalls: McpCall[];
  responseFormat: ResponseFormat;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type EditorState = {
  templateName: string;
  description: string;
  triggerType: TriggerType;
  triggerCron: string;
  watchEntityTypes: string;
  mcpCalls: McpCall[];
  responseFormat: ResponseFormat;
  isActive: boolean;
};

type Props = {
  initial?: WorkflowTemplate | null;
  workspaceId: string;
  onSave: (data: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  onCancel: () => void;
};

const BLANK: EditorState = {
  templateName: '',
  description: '',
  triggerType: 'manual',
  triggerCron: '',
  watchEntityTypes: '',
  mcpCalls: [{ tool: '', params: {} }],
  responseFormat: 'text',
  isActive: true,
};

function templateToState(t: WorkflowTemplate): EditorState {
  return {
    templateName: t.templateName,
    description: t.description,
    triggerType: t.triggerType,
    triggerCron: t.triggerConfig.cron ?? '',
    watchEntityTypes: (t.triggerConfig.watchEntityTypes ?? []).join(', '),
    mcpCalls: t.mcpCalls,
    responseFormat: t.responseFormat,
    isActive: t.isActive,
  };
}

function stateToPayload(
  state: EditorState,
  workspaceId: string,
): Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'> {
  const triggerConfig: WorkflowTemplate['triggerConfig'] = {};
  if (state.triggerType === 'calendar' && state.triggerCron) {
    triggerConfig.cron = state.triggerCron;
  }
  if (state.triggerType === 'entity_change' && state.watchEntityTypes) {
    triggerConfig.watchEntityTypes = state.watchEntityTypes.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return {
    workspaceId,
    templateName: state.templateName,
    description: state.description,
    triggerType: state.triggerType,
    triggerConfig,
    mcpCalls: state.mcpCalls.filter((c) => c.tool.trim()),
    responseFormat: state.responseFormat,
    isActive: state.isActive,
  };
}

export function WorkflowTemplateEditor({ initial, workspaceId, onSave, onCancel }: Props) {
  const [state, setState] = useState<EditorState>(
    initial ? templateToState(initial) : BLANK,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function updateMcpCall(index: number, field: keyof McpCall, value: string) {
    setState((prev) => {
      const updated = prev.mcpCalls.map((c, i) => {
        if (i !== index) return c;
        if (field === 'tool') return { ...c, tool: value };
        try {
          return { ...c, params: JSON.parse(value) };
        } catch {
          return c;
        }
      });
      return { ...prev, mcpCalls: updated };
    });
  }

  function addMcpCall() {
    setState((prev) => ({ ...prev, mcpCalls: [...prev.mcpCalls, { tool: '', params: {} }] }));
  }

  function removeMcpCall(index: number) {
    setState((prev) => ({ ...prev, mcpCalls: prev.mcpCalls.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!state.templateName.trim()) {
      setError('Template name is required.');
      return;
    }
    if (state.mcpCalls.filter((c) => c.tool.trim()).length === 0) {
      setError('At least one MCP step is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(stateToPayload(state, workspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
        <input
          value={state.templateName}
          onChange={(e) => set('templateName', e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g. Daily Sales Summary"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={state.description}
          onChange={(e) => set('description', e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={2}
          placeholder="Brief description of what this workflow does"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
          <select
            value={state.triggerType}
            onChange={(e) => set('triggerType', e.target.value as TriggerType)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="manual">Manual</option>
            <option value="calendar">Scheduled (Calendar)</option>
            <option value="entity_change">On Entity Change</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Response Format</label>
          <select
            value={state.responseFormat}
            onChange={(e) => set('responseFormat', e.target.value as ResponseFormat)}
            className="w-full border rounded px-3 py-2 text-sm"
          >
            <option value="text">Text</option>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
          </select>
        </div>
      </div>

      {state.triggerType === 'calendar' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cron Expression</label>
          <input
            value={state.triggerCron}
            onChange={(e) => set('triggerCron', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm font-mono"
            placeholder="0 9 * * 1-5 (Mon–Fri 9am)"
          />
        </div>
      )}

      {state.triggerType === 'entity_change' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Watch Entity Types (comma-separated)</label>
          <input
            value={state.watchEntityTypes}
            onChange={(e) => set('watchEntityTypes', e.target.value)}
            className="w-full border rounded px-3 py-2 text-sm"
            placeholder="contact, deal, invoice"
          />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">MCP Steps *</label>
          <button type="button" onClick={addMcpCall} className="text-xs text-blue-600 hover:text-blue-800">
            + Add step
          </button>
        </div>
        <div className="space-y-3">
          {state.mcpCalls.map((call, i) => (
            <div key={i} className="border rounded p-3 bg-gray-50 space-y-2">
              <div className="flex gap-2 items-center">
                <span className="text-xs text-gray-400 w-6 text-right">{i + 1}.</span>
                <input
                  value={call.tool}
                  onChange={(e) => updateMcpCall(i, 'tool', e.target.value)}
                  className="flex-1 border rounded px-2 py-1 text-sm font-mono"
                  placeholder="query-context"
                />
                {state.mcpCalls.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMcpCall(i)}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    Remove
                  </button>
                )}
              </div>
              <textarea
                defaultValue={JSON.stringify(call.params, null, 2)}
                onChange={(e) => updateMcpCall(i, 'params', e.target.value)}
                className="w-full border rounded px-2 py-1 text-xs font-mono"
                rows={3}
                placeholder='{"query": "active deals", "topK": 10}'
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="isActive"
          type="checkbox"
          checked={state.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
          className="rounded"
        />
        <label htmlFor="isActive" className="text-sm text-gray-700">Active (enabled for execution)</label>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : initial ? 'Update Template' : 'Create Template'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2 bg-white border text-sm font-medium rounded hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
