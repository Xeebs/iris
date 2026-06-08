'use client';

import { useState } from 'react';

type SchemaChange = {
  kind: string;
  entityType: string;
  fieldName?: string;
  newFieldName?: string;
  breaking: boolean;
  description: string;
};

type MigrationPlan = {
  sourceVersion: string;
  targetVersion: string;
  changes: SchemaChange[];
  affectedEntityTypes: string[];
  requiresReindex: boolean;
  fieldMappings: Array<{ entityType: string; oldFieldName: string; newFieldName: string }>;
  estimatedAffectedCount?: number;
};

type Props = {
  plan: MigrationPlan;
  connectorId: string;
  workspaceId: string;
  onApplied?: () => void;
};

const KIND_LABELS: Record<string, string> = {
  add_field: 'Add field',
  remove_field: 'Remove field',
  rename_field: 'Rename field',
  change_type: 'Change type',
  add_entity_type: 'Add entity type',
  remove_entity_type: 'Remove entity type',
};

/**
 * Renders a detailed migration plan with impact summary and one-click apply.
 * Designed to be embedded in an admin page alongside the SchemaMigrationsPage.
 */
export function SchemaMigrationPlanner({ plan, connectorId, workspaceId, onApplied }: Props) {
  const [applying, setApplying] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const breakingCount = plan.changes.filter((c) => c.breaking).length;
  const addedCount = plan.changes.filter((c) => c.kind === 'add_field' || c.kind === 'add_entity_type').length;
  const removedCount = plan.changes.filter((c) => c.kind === 'remove_field' || c.kind === 'remove_entity_type').length;

  async function apply() {
    setApplying(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/connectors/${connectorId}/schema/migrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({
          sourceVersion: plan.sourceVersion,
          targetVersion: plan.targetVersion,
          affectedEntityCount: plan.estimatedAffectedCount,
        }),
      });

      if (res.ok) {
        setMsg({ type: 'ok', text: `Migration ${plan.sourceVersion} → ${plan.targetVersion} started successfully.` });
        onApplied?.();
      } else {
        const body = await res.json() as { error?: { message?: string } };
        setMsg({ type: 'err', text: body.error?.message ?? 'Migration failed to start.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Network error. Please try again.' });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">
            Migration Plan: <span className="font-mono text-indigo-600">{plan.sourceVersion}</span>
            <span className="text-gray-400 mx-2">→</span>
            <span className="font-mono text-indigo-600">{plan.targetVersion}</span>
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Connector: {connectorId} · {plan.affectedEntityTypes.length} entity type(s) affected
          </p>
        </div>
        <span
          className={`text-sm px-3 py-1 rounded-full font-medium ${
            plan.requiresReindex ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {plan.requiresReindex ? 'Requires re-index' : 'Safe migration'}
        </span>
      </div>

      {/* Impact summary */}
      <div className="px-5 py-3 grid grid-cols-4 gap-3 border-b border-gray-100 bg-gray-50">
        <Stat label="Total changes" value={plan.changes.length} />
        <Stat label="Breaking" value={breakingCount} highlight={breakingCount > 0} />
        <Stat label="Additions" value={addedCount} />
        <Stat label="Removals" value={removedCount} highlight={removedCount > 0} />
      </div>

      {/* Change list */}
      <div className="px-5 py-4 space-y-1 max-h-72 overflow-y-auto">
        {plan.changes.map((c, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-md ${
              c.breaking ? 'bg-red-50' : 'bg-gray-50'
            }`}
          >
            <span
              className={`font-medium shrink-0 w-28 ${c.breaking ? 'text-red-600' : 'text-gray-500'}`}
            >
              {KIND_LABELS[c.kind] ?? c.kind}
            </span>
            <span className={c.breaking ? 'text-red-700' : 'text-gray-600'}>{c.description}</span>
            {c.breaking && (
              <span className="ml-auto shrink-0 text-xs font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                breaking
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Field mappings */}
      {plan.fieldMappings.length > 0 && (
        <div className="px-5 py-3 border-t border-gray-100 bg-blue-50">
          <p className="text-xs font-medium text-blue-700 mb-2">Inferred field renames</p>
          <div className="space-y-1">
            {plan.fieldMappings.map((m, i) => (
              <div key={i} className="text-xs text-blue-600">
                <span className="font-mono">{m.entityType}.{m.oldFieldName}</span>
                <span className="mx-2 text-blue-400">→</span>
                <span className="font-mono">{m.newFieldName}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`mx-5 my-3 rounded-md p-3 text-sm ${
            msg.type === 'ok'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-3">
        <button
          onClick={() => void apply()}
          disabled={applying}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {applying ? 'Starting migration…' : 'Apply Migration'}
        </button>
        {plan.requiresReindex && (
          <p className="text-xs text-red-600">
            Warning: this migration requires a full re-index of affected entity types.
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${highlight && value > 0 ? 'text-red-600' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
