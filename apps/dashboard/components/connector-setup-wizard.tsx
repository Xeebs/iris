'use client';

import { useState, useCallback } from 'react';
import { SchemaMapper } from './schema-mapper';
import type { ConnectorManifest } from '@/lib/api';
import {
  WIZARD_STEPS,
  STEP_LABELS,
  INITIAL_WIZARD_STATE,
  nextStep,
  prevStep,
  stepIndex,
  requiresOAuth,
  buildOAuthUrl,
  buildSchemaFields,
} from '@/lib/setup-wizard';
import type { WizardState, SchemaField, SyncFrequency } from '@/lib/setup-wizard';

const FREQUENCY_OPTIONS: { value: SyncFrequency; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual only', description: 'Sync only when you trigger it manually' },
  { value: 'hourly', label: 'Hourly', description: 'Sync every hour' },
  { value: 'daily', label: 'Daily', description: 'Sync once per day at 9:00 AM UTC' },
  { value: 'weekly', label: 'Weekly', description: 'Sync every Monday at 9:00 AM UTC' },
  { value: 'real-time', label: 'Real-time (webhooks)', description: 'Sync as events arrive via webhooks' },
];

const DEFAULT_POSTGRES_CONFIG = JSON.stringify(
  {
    connectionString: 'postgres://user:password@host:5432/dbname',
    tables: [
      { name: 'contacts', entityType: 'contact', labelColumns: ['first_name', 'last_name'], updatedAtColumn: 'updated_at' },
      { name: 'companies', entityType: 'company', labelColumn: 'name', updatedAtColumn: 'created_at' },
    ],
  },
  null,
  2,
);

type ConnectorSetupWizardProps = {
  connectorTypes: ConnectorManifest[];
  apiBase: string;
};

function StepIndicator({ currentStep }: { currentStep: WizardState['currentStep'] }): React.JSX.Element {
  const currentIdx = stepIndex(currentStep);
  return (
    <nav className="mb-8 flex items-center gap-2">
      {WIZARD_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
              i < currentIdx
                ? 'bg-gray-900 text-white'
                : i === currentIdx
                  ? 'border-2 border-gray-900 bg-white text-gray-900'
                  : 'bg-gray-200 text-gray-400'
            }`}
          >
            {i < currentIdx ? '✓' : i + 1}
          </div>
          <span
            className={`text-sm ${i === currentIdx ? 'font-medium text-gray-900' : 'text-gray-400'}`}
          >
            {STEP_LABELS[step]}
          </span>
          {i < WIZARD_STEPS.length - 1 && (
            <div className={`h-px w-8 ${i < currentIdx ? 'bg-gray-900' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </nav>
  );
}

/**
 * Multi-step connector setup wizard.
 *
 * @param connectorTypes - Available connector manifests from the API
 * @param apiBase - REST API base URL for creating the instance
 */
export function ConnectorSetupWizard({
  connectorTypes,
  apiBase,
}: ConnectorSetupWizardProps): React.JSX.Element {
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});
  const [postgresConfigText, setPostgresConfigText] = useState(DEFAULT_POSTGRES_CONFIG);
  const [postgresConfigError, setPostgresConfigError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'triggering' | 'triggered'>('idle');

  const selectedManifest = connectorTypes.find((c) => c.id === state.selectedConnectorId);
  const isPostgres = state.selectedConnectorId === 'postgres';

  const advance = useCallback(() => {
    setState((s) => ({ ...s, currentStep: nextStep(s.currentStep) ?? s.currentStep }));
    setError(null);
  }, []);

  const retreat = useCallback(() => {
    setState((s) => ({ ...s, currentStep: prevStep(s.currentStep) ?? s.currentStep }));
    setError(null);
  }, []);

  const handleSelectConnector = useCallback((id: string) => {
    setState((s) => ({ ...s, selectedConnectorId: id }));
  }, []);

  const handleAuthNext = useCallback(() => {
    if (!selectedManifest) return;
    if (requiresOAuth(selectedManifest)) {
      window.location.href = buildOAuthUrl(selectedManifest.id, apiBase);
      return;
    }
    if (isPostgres) {
      try {
        const parsed = JSON.parse(postgresConfigText) as Record<string, unknown>;
        setState((s) => ({ ...s, rawConfig: parsed }));
        setPostgresConfigError(null);
      } catch {
        setPostgresConfigError('Invalid JSON — please fix the config before continuing.');
        return;
      }
    } else {
      setState((s) => ({ ...s, authData: apiKeyInput }));
    }
    advance();
  }, [selectedManifest, apiKeyInput, apiBase, isPostgres, postgresConfigText, advance]);

  const handleSchemaDiscovered = useCallback(() => {
    const mockFields = [
      { name: 'id', type: 'text', nullable: false },
      { name: 'name', type: 'text', nullable: true },
      { name: 'email', type: 'text', nullable: true },
      { name: 'created_at', type: 'timestamp', nullable: false },
    ];
    setState((s) => ({ ...s, schemaFields: buildSchemaFields(mockFields) }));
    advance();
  }, [advance]);

  const handleFieldToggle = useCallback((fieldName: string, included: boolean) => {
    setState((s) => ({
      ...s,
      schemaFields: s.schemaFields.map((f) =>
        f.name === fieldName ? { ...f, included } : f,
      ),
    }));
  }, []);

  const handleFrequencyChange = useCallback((frequency: SyncFrequency) => {
    setState((s) => ({ ...s, syncFrequency: frequency }));
  }, []);

  const handleCreate = useCallback(async () => {
    if (!state.selectedConnectorId) return;
    setCreating(true);
    setError(null);
    try {
      const config = state.rawConfig ?? state.authData;
      const res = await fetch(`${apiBase}/connectors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'default',
          connectorId: state.selectedConnectorId,
          config,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? 'Failed to create connector');
      }
      const created = (await res.json()) as { data: { id: string } };
      const id = created.data.id;
      setInstanceId(id);

      if (state.syncFrequency !== 'manual') {
        await fetch(`${apiBase}/connectors/${id}/schedule?workspaceId=default`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frequency: state.syncFrequency }),
        });
      }

      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    } finally {
      setCreating(false);
    }
  }, [state, apiBase]);

  const handleTriggerSync = useCallback(async () => {
    if (!instanceId) return;
    setSyncState('triggering');
    try {
      await fetch(`${apiBase}/connectors/${instanceId}/sync?workspaceId=default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      setSyncState('triggered');
    } catch {
      setSyncState('idle');
    }
  }, [instanceId, apiBase]);

  if (done && instanceId) {
    const mcpSnippet = JSON.stringify(
      {
        mcpServers: {
          iris: {
            command: 'node',
            args: ['<path-to-iris>/apps/mcp-server/dist/server.js'],
            env: {
              IRIS_API_KEY: '<your-api-key>',
              DATABASE_URL: '<your-iris-database-url>',
              EMBEDDING_PROVIDER: 'ollama',
            },
          },
        },
      },
      null,
      2,
    );

    return (
      <div data-testid="setup-done">
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-6">
          <p className="font-semibold text-green-800">Connector created!</p>
          <p className="mt-1 text-sm text-green-700">
            Connector ID: <code className="font-mono text-xs">{instanceId}</code>
          </p>
        </div>

        <div className="mb-8">
          <h2 className="mb-2 text-lg font-semibold">Step 1 — Sync your data</h2>
          <p className="mb-3 text-sm text-gray-600">
            Trigger an initial sync so Iris indexes your data and makes it available to your AI clients.
          </p>
          {syncState === 'idle' && (
            <button
              onClick={handleTriggerSync}
              data-testid="trigger-sync-btn"
              className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
              type="button"
            >
              Trigger Initial Sync
            </button>
          )}
          {syncState === 'triggering' && (
            <p className="text-sm text-gray-500">Starting sync…</p>
          )}
          {syncState === 'triggered' && (
            <p className="text-sm text-green-700" data-testid="sync-triggered-msg">
              Sync started. Check the connectors page for progress.
            </p>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-lg font-semibold">Step 2 — Connect your AI client</h2>
          <p className="mb-3 text-sm text-gray-600">
            Add this block to your Claude Code <code className="font-mono text-xs">.mcp.json</code> or
            run <code className="font-mono text-xs">claude mcp add iris</code>. Replace the placeholders
            with your Iris API key (find it in Settings → API Keys).
          </p>
          <pre
            data-testid="mcp-snippet"
            className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs font-mono text-gray-800"
          >
            {mcpSnippet}
          </pre>
        </div>

        <div className="mt-6">
          <a
            href="/connectors"
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            ← Back to Connectors
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepIndicator currentStep={state.currentStep} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {state.currentStep === 'select' && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Choose a connector type</h2>
          {connectorTypes.length === 0 ? (
            <p className="text-sm text-gray-500">No connector types available.</p>
          ) : (
            <div className="space-y-3">
              {connectorTypes.map((c) => (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-start gap-4 rounded-lg border p-4 transition-colors ${
                    state.selectedConnectorId === c.id
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="connector"
                    value={c.id}
                    checked={state.selectedConnectorId === c.id}
                    onChange={() => handleSelectConnector(c.id)}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-sm text-gray-500">{c.description}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="mt-6 flex justify-end">
            <button
              onClick={advance}
              disabled={!state.selectedConnectorId}
              data-testid="select-continue-btn"
              className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
              type="button"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {state.currentStep === 'auth' && selectedManifest && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Configure {selectedManifest.name}</h2>
          {requiresOAuth(selectedManifest) ? (
            <div>
              <p className="mb-4 text-sm text-gray-600">
                You will be redirected to {selectedManifest.name} to authorise Iris.
              </p>
              <div className="flex gap-3">
                <button onClick={retreat} type="button" className="text-sm text-gray-500 hover:text-gray-700">
                  ← Back
                </button>
                <button
                  onClick={handleAuthNext}
                  className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
                  type="button"
                >
                  Authorise with {selectedManifest.name}
                </button>
              </div>
            </div>
          ) : isPostgres ? (
            <div>
              <p className="mb-3 text-sm text-gray-600">
                Configure the connection string and tables to index. Edit the JSON below.
              </p>
              <textarea
                value={postgresConfigText}
                onChange={(e) => {
                  setPostgresConfigText(e.target.value);
                  setPostgresConfigError(null);
                }}
                data-testid="postgres-config-input"
                rows={18}
                spellCheck={false}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs shadow-sm focus:border-gray-500 focus:outline-none"
              />
              {postgresConfigError && (
                <p className="mt-1 text-xs text-red-600">{postgresConfigError}</p>
              )}
              <div className="mt-4 flex gap-3">
                <button onClick={retreat} type="button" className="text-sm text-gray-500 hover:text-gray-700">
                  ← Back
                </button>
                <button
                  onClick={handleAuthNext}
                  data-testid="postgres-config-continue-btn"
                  className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
                  type="button"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-gray-600">Enter your API credentials.</p>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">API Key</span>
                <input
                  type="password"
                  value={apiKeyInput['apiKey'] ?? ''}
                  onChange={(e) => setApiKeyInput({ apiKey: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none"
                  placeholder="sk-…"
                />
              </label>
              <div className="mt-6 flex gap-3">
                <button onClick={retreat} type="button" className="text-sm text-gray-500 hover:text-gray-700">
                  ← Back
                </button>
                <button
                  onClick={handleAuthNext}
                  disabled={!apiKeyInput['apiKey']}
                  className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
                  type="button"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {state.currentStep === 'schema' && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Schema Discovery</h2>
          <p className="mb-4 text-sm text-gray-600">
            {isPostgres
              ? 'Your tables are already configured — continue to field mapping.'
              : 'Iris will inspect the connector schema to understand which fields to index.'}
          </p>
          <div className="flex gap-3">
            <button onClick={retreat} type="button" className="text-sm text-gray-500 hover:text-gray-700">
              ← Back
            </button>
            <button
              onClick={handleSchemaDiscovered}
              className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
              type="button"
            >
              {isPostgres ? 'Continue' : 'Discover Schema'}
            </button>
          </div>
        </section>
      )}

      {state.currentStep === 'mapping' && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Field Mapping</h2>
          <p className="mb-4 text-sm text-gray-600">
            Choose which fields to include in the semantic index.
          </p>
          {!isPostgres && (
            <SchemaMapper fields={state.schemaFields} onToggle={handleFieldToggle} />
          )}

          <div className="mt-8">
            <h3 className="mb-1 text-base font-semibold">Sync Frequency</h3>
            <p className="mb-3 text-sm text-gray-600">How often should Iris sync this connector?</p>
            <div className="space-y-2">
              {FREQUENCY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    state.syncFrequency === opt.value
                      ? 'border-gray-900 bg-gray-50'
                      : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <input
                    type="radio"
                    name="syncFrequency"
                    value={opt.value}
                    checked={state.syncFrequency === opt.value}
                    onChange={() => handleFrequencyChange(opt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-gray-500">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button onClick={retreat} type="button" className="text-sm text-gray-500 hover:text-gray-700">
              ← Back
            </button>
            <button
              onClick={advance}
              className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700"
              type="button"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {state.currentStep === 'review' && selectedManifest && (
        <section>
          <h2 className="mb-1 text-lg font-semibold">Review & Connect</h2>
          <div className="mb-6 rounded-lg border bg-gray-50 p-4 text-sm">
            <dl className="space-y-2">
              <div className="flex justify-between">
                <dt className="text-gray-500">Connector</dt>
                <dd className="font-medium">{selectedManifest.name}</dd>
              </div>
              {isPostgres ? (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tables</dt>
                  <dd className="font-medium">
                    {(() => {
                      try {
                        const cfg = JSON.parse(postgresConfigText) as { tables?: Array<{ name: string }> };
                        return cfg.tables?.map((t) => t.name).join(', ') ?? '—';
                      } catch {
                        return '—';
                      }
                    })()}
                  </dd>
                </div>
              ) : (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Fields indexed</dt>
                  <dd className="font-medium">
                    {state.schemaFields.filter((f) => f.included).length} of {state.schemaFields.length}
                  </dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Sync frequency</dt>
                <dd className="font-medium capitalize">{state.syncFrequency.replace('-', ' ')}</dd>
              </div>
            </dl>
          </div>
          <div className="flex gap-3">
            <button onClick={retreat} type="button" className="text-sm text-gray-500 hover:text-gray-700">
              ← Back
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              data-testid="connect-btn"
              className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
              type="button"
            >
              {creating ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
