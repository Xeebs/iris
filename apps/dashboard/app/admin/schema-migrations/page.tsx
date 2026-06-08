'use client';

import { useState, useEffect, useCallback } from 'react';

type SchemaVersion = {
  connectorId: string;
  version: string;
  releasedAt: string;
  breakingChanges: Array<{
    kind: string;
    entityType: string;
    fieldName?: string;
    breaking: boolean;
    description: string;
  }>;
};

type Migration = {
  connectorId: string;
  sourceVersion: string;
  targetVersion: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  affectedEntityCount: number | null;
};

type MigrationPlan = {
  changes: Array<{ kind: string; entityType: string; fieldName?: string; breaking: boolean; description: string }>;
  affectedEntityTypes: string[];
  requiresReindex: boolean;
  fieldMappings: Array<{ entityType: string; oldFieldName: string; newFieldName: string }>;
};

const CONNECTORS = ['hubspot', 'salesforce', 'google-workspace', 'slack', 'jira'] as const;
const STATUS_COLORS: Record<Migration['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function SchemaMigrationsPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [selectedConnector, setSelectedConnector] = useState<string>(CONNECTORS[0]);
  const [versions, setVersions] = useState<SchemaVersion[]>([]);
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [planFrom, setPlanFrom] = useState('');
  const [planTo, setPlanTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedConnector || !workspaceId) return;
    setLoading(true);
    try {
      const [versRes, migRes] = await Promise.all([
        fetch(`/api/v1/connectors/${selectedConnector}/schema/versions`),
        fetch(`/api/v1/connectors/${selectedConnector}/schema/migrations`, {
          headers: { 'x-workspace-id': workspaceId },
        }),
      ]);

      if (versRes.ok) {
        const { data } = await versRes.json() as { data: SchemaVersion[] };
        setVersions(data);
        if (data.length >= 2) {
          setPlanFrom(data[data.length - 2]!.version);
          setPlanTo(data[data.length - 1]!.version);
        }
      }
      if (migRes.ok) {
        const { data } = await migRes.json() as { data: Migration[] };
        setMigrations(data);
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to load schema data.' });
    } finally {
      setLoading(false);
    }
  }, [selectedConnector, workspaceId]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function previewPlan() {
    if (!planFrom || !planTo) return;
    try {
      const res = await fetch(
        `/api/v1/connectors/${selectedConnector}/schema/migration-plan?from=${encodeURIComponent(planFrom)}&to=${encodeURIComponent(planTo)}`,
      );
      if (res.ok) {
        const { data } = await res.json() as { data: MigrationPlan };
        setPlan(data);
      } else {
        setMsg({ type: 'err', text: 'Could not compute migration plan.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to fetch plan.' });
    }
  }

  async function applyMigration() {
    if (!plan || !workspaceId) return;
    setStarting(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/connectors/${selectedConnector}/schema/migrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ sourceVersion: planFrom, targetVersion: planTo }),
      });
      if (res.ok) {
        setMsg({ type: 'ok', text: `Migration from ${planFrom} → ${planTo} started.` });
        setPlan(null);
        void loadData();
      } else {
        const body = await res.json() as { error?: { message?: string } };
        setMsg({ type: 'err', text: body.error?.message ?? 'Failed to start migration.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Network error.' });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Schema Migrations</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage connector schema evolution and migrate workspace data to new schema versions.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Workspace ID</label>
          <input
            type="text"
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            placeholder="your-workspace-uuid"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Connector</label>
          <select
            value={selectedConnector}
            onChange={(e) => setSelectedConnector(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            {CONNECTORS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {msg && (
        <div className={`rounded-md p-3 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Version History */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Schema Versions</h2>
        {loading ? (
          <div className="text-sm text-gray-400 animate-pulse">Loading…</div>
        ) : versions.length === 0 ? (
          <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg p-6 text-center">
            No schema versions recorded for this connector.
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v) => (
              <div key={v.version} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 bg-white">
                <div>
                  <span className="font-mono text-sm font-semibold text-gray-900">{v.version}</span>
                  <span className="text-xs text-gray-400 ml-3">{new Date(v.releasedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  {v.breakingChanges.length > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                      {v.breakingChanges.length} breaking
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Migration Planner */}
      {versions.length >= 2 && (
        <div className="border border-gray-200 rounded-lg p-5 bg-gray-50 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Plan Migration</h2>
          <div className="flex items-center gap-3">
            <select
              value={planFrom}
              onChange={(e) => { setPlanFrom(e.target.value); setPlan(null); }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {versions.map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
            </select>
            <span className="text-gray-400">→</span>
            <select
              value={planTo}
              onChange={(e) => { setPlanTo(e.target.value); setPlan(null); }}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {versions.map((v) => <option key={v.version} value={v.version}>{v.version}</option>)}
            </select>
            <button
              onClick={() => void previewPlan()}
              className="px-3 py-2 bg-white border border-gray-300 text-sm rounded-md hover:bg-gray-50"
            >
              Preview
            </button>
          </div>

          {plan && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`text-sm px-2 py-1 rounded font-medium ${plan.requiresReindex ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                  {plan.requiresReindex ? 'Requires re-index' : 'Non-breaking migration'}
                </span>
                <span className="text-sm text-gray-500">{plan.changes.length} changes · {plan.affectedEntityTypes.length} entity types</span>
              </div>

              <div className="space-y-1 max-h-48 overflow-y-auto">
                {plan.changes.map((c, i) => (
                  <div key={i} className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${c.breaking ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                    <span className="font-mono">{c.kind}</span>
                    <span>{c.description}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => void applyMigration()}
                disabled={starting}
                className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {starting ? 'Starting…' : 'Apply Migration'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active Migrations */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Migration History</h2>
        {migrations.length === 0 ? (
          <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg p-6 text-center">
            No migrations started for this workspace + connector.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left py-2 pr-4">From</th>
                  <th className="text-left py-2 pr-4">To</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">Entities</th>
                  <th className="text-left py-2">Completed</th>
                </tr>
              </thead>
              <tbody>
                {migrations.map((m, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-4 font-mono">{m.sourceVersion}</td>
                    <td className="py-2 pr-4 font-mono">{m.targetVersion}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[m.status]}`}>
                        {m.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{m.affectedEntityCount?.toLocaleString() ?? '—'}</td>
                    <td className="py-2 text-gray-400">
                      {m.completedAt ? new Date(m.completedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
