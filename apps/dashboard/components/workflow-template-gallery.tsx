'use client';

import { useState } from 'react';

export interface WorkflowTemplate {
  id: string;
  workspaceId: string;
  templateName: string;
  description: string;
  triggerType: 'manual' | 'calendar' | 'entity_change';
  triggerConfig: { cron?: string; watchEntityTypes?: string[] };
  mcpCalls: { tool: string; params: Record<string, unknown> }[];
  responseFormat: 'text' | 'json' | 'markdown';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type Props = {
  templates: WorkflowTemplate[];
  onSelect: (template: WorkflowTemplate) => void;
  onDelete: (id: string) => Promise<void>;
  onToggleActive: (id: string, isActive: boolean) => Promise<void>;
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  calendar: 'Scheduled',
  entity_change: 'On Change',
};

const FORMAT_LABELS: Record<string, string> = {
  text: 'Text',
  json: 'JSON',
  markdown: 'Markdown',
};

export function WorkflowTemplateGallery({ templates, onSelect, onDelete, onToggleActive }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setBusy(id);
    setError(null);
    try {
      await onDelete(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle(id: string, current: boolean) {
    setBusy(id);
    setError(null);
    try {
      await onToggleActive(id, !current);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        No workflow templates yet. Create one to get started.
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((tmpl) => (
          <div
            key={tmpl.id}
            className={`border rounded-lg p-4 bg-white shadow-sm flex flex-col gap-2 ${
              !tmpl.isActive ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <h3
                className="font-semibold text-gray-900 cursor-pointer hover:text-blue-600 truncate"
                onClick={() => onSelect(tmpl)}
                title={tmpl.templateName}
              >
                {tmpl.templateName}
              </h3>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                  tmpl.isActive
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {tmpl.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>

            {tmpl.description && (
              <p className="text-sm text-gray-500 line-clamp-2">{tmpl.description}</p>
            )}

            <div className="flex gap-2 flex-wrap text-xs">
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                {TRIGGER_LABELS[tmpl.triggerType] ?? tmpl.triggerType}
              </span>
              <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">
                {FORMAT_LABELS[tmpl.responseFormat] ?? tmpl.responseFormat}
              </span>
              <span className="bg-gray-50 text-gray-600 px-2 py-0.5 rounded">
                {tmpl.mcpCalls.length} step{tmpl.mcpCalls.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="flex gap-2 mt-auto pt-2 border-t border-gray-100">
              <button
                onClick={() => onSelect(tmpl)}
                className="flex-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                disabled={busy === tmpl.id}
              >
                Edit
              </button>
              <button
                onClick={() => handleToggle(tmpl.id, tmpl.isActive)}
                className="flex-1 text-sm text-gray-600 hover:text-gray-800"
                disabled={busy === tmpl.id}
              >
                {tmpl.isActive ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => handleDelete(tmpl.id)}
                className="flex-1 text-sm text-red-500 hover:text-red-700"
                disabled={busy === tmpl.id}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
