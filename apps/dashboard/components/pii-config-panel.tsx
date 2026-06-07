'use client';

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type PiiStrategy = 'redact' | 'hash' | 'tokenize';

interface PiiFieldConfig {
  fieldName: string;
  strategy: PiiStrategy;
  customPattern?: string;
}

interface WorkspacePiiConfig {
  workspaceId: string;
  enableAutoDetection: boolean;
  defaultStrategy: PiiStrategy;
  fieldConfigs: PiiFieldConfig[];
}

interface PiiConfigPanelProps {
  workspaceId: string;
  initialConfig: WorkspacePiiConfig | null;
  onSave: (config: { enableAutoDetection: boolean; defaultStrategy: PiiStrategy }) => Promise<void>;
  onAddField: (field: PiiFieldConfig) => Promise<void>;
  onDeleteField: (fieldName: string) => Promise<void>;
}

const STRATEGY_LABELS: Record<PiiStrategy, { label: string; description: string }> = {
  redact: { label: 'Redact', description: 'Replace with [REDACTED]' },
  hash: { label: 'Hash', description: 'One-way SHA-256 hash (16 chars)' },
  tokenize: { label: 'Tokenize', description: 'Deterministic token (reversible with key)' },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dashboard panel for configuring workspace-level PII detection and field masking.
 *
 * @param workspaceId   - Workspace to configure
 * @param initialConfig - Current config loaded from API (null = not yet configured)
 * @param onSave        - Callback to persist workspace-level settings
 * @param onAddField    - Callback to add or update a field override
 * @param onDeleteField - Callback to remove a field override
 */
export function PiiConfigPanel({
  workspaceId,
  initialConfig,
  onSave,
  onAddField,
  onDeleteField,
}: PiiConfigPanelProps): React.JSX.Element {
  const [autoDetect, setAutoDetect] = useState(initialConfig?.enableAutoDetection ?? true);
  const [defaultStrategy, setDefaultStrategy] = useState<PiiStrategy>(
    initialConfig?.defaultStrategy ?? 'redact',
  );
  const [fieldConfigs, setFieldConfigs] = useState<PiiFieldConfig[]>(
    initialConfig?.fieldConfigs ?? [],
  );
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldStrategy, setNewFieldStrategy] = useState<PiiStrategy>('redact');
  const [saving, setSaving] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ enableAutoDetection: autoDetect, defaultStrategy });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = async () => {
    if (!newFieldName.trim()) return;
    setAddingField(true);
    setSaveError(null);
    try {
      const config = { fieldName: newFieldName.trim(), strategy: newFieldStrategy };
      await onAddField(config);
      setFieldConfigs(prev => {
        const next = prev.filter(f => f.fieldName !== config.fieldName);
        return [...next, config];
      });
      setNewFieldName('');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to add field');
    } finally {
      setAddingField(false);
    }
  };

  const handleDeleteField = async (fieldName: string) => {
    try {
      await onDeleteField(fieldName);
      setFieldConfigs(prev => prev.filter(f => f.fieldName !== fieldName));
    } catch {
      // silently fail — the UI stays in sync if the call fails
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">PII & Data Masking</h2>
      <p className="mt-1 text-sm text-gray-500">
        Configure how sensitive fields are handled when serving context to AI tools.
        Workspace ID: <span className="font-mono text-xs">{workspaceId}</span>
      </p>

      {saveError && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>
      )}

      {/* Global settings */}
      <section className="mt-6 space-y-4">
        <h3 className="text-sm font-medium text-gray-700">Global Settings</h3>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoDetect}
            onChange={e => setAutoDetect(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <span className="text-sm font-medium text-gray-700">Enable auto-detection</span>
            <p className="text-xs text-gray-500">
              Automatically detect PII by field name (email, phone, SSN, etc.) and value pattern
            </p>
          </div>
        </label>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Default masking strategy
          </label>
          <div className="flex gap-3">
            {(Object.keys(STRATEGY_LABELS) as PiiStrategy[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setDefaultStrategy(s)}
                className={`rounded-md px-3 py-2 text-sm font-medium border transition-colors ${
                  defaultStrategy === s
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                }`}
              >
                <span className="block font-medium">{STRATEGY_LABELS[s].label}</span>
                <span className="block text-xs opacity-75">{STRATEGY_LABELS[s].description}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </section>

      {/* Field overrides */}
      <section className="mt-8">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Field Overrides</h3>

        {fieldConfigs.length > 0 && (
          <ul className="mb-4 divide-y divide-gray-100 rounded-md border border-gray-200">
            {fieldConfigs.map(fc => (
              <li key={fc.fieldName} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-mono text-sm text-gray-800">{fc.fieldName}</span>
                  <span className={`ml-3 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    fc.strategy === 'redact' ? 'bg-red-50 text-red-700' :
                    fc.strategy === 'hash'   ? 'bg-yellow-50 text-yellow-700' :
                                               'bg-blue-50 text-blue-700'
                  }`}>
                    {STRATEGY_LABELS[fc.strategy].label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDeleteField(fc.fieldName)}
                  className="text-xs text-gray-400 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newFieldName}
            onChange={e => setNewFieldName(e.target.value)}
            placeholder="Field name (e.g., salary)"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <select
            value={newFieldStrategy}
            onChange={e => setNewFieldStrategy(e.target.value as PiiStrategy)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {(Object.keys(STRATEGY_LABELS) as PiiStrategy[]).map(s => (
              <option key={s} value={s}>{STRATEGY_LABELS[s].label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleAddField()}
            disabled={addingField || !newFieldName.trim()}
            className="rounded-md bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {addingField ? '…' : 'Add'}
          </button>
        </div>

        <p className="mt-2 text-xs text-gray-400">
          Field overrides take precedence over auto-detection and apply regardless of value content.
        </p>
      </section>
    </div>
  );
}
