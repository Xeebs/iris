'use client';

import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type InferredFieldType = 'string' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'id' | 'unknown';

interface DiscoveredField {
  name: string;
  inferredType: InferredFieldType;
  isPii: boolean;
  accepted: boolean;
  sampleValues: string[];
  nullRate: number;
  confidence: number;
}

export interface SchemaFieldDecision {
  originalName: string;
  accepted: boolean;
  renamedTo?: string;
  isPii: boolean;
  entityRelationshipType?: string;
}

interface SchemaFieldMapperProps {
  entityType: string;
  fields: DiscoveredField[];
  onConfirm: (entityType: string, decisions: SchemaFieldDecision[]) => Promise<void>;
  onEntityTypeChange?: (name: string) => void;
}

const TYPE_BADGE: Record<InferredFieldType, string> = {
  string: 'bg-gray-100 text-gray-700',
  number: 'bg-blue-50 text-blue-700',
  boolean: 'bg-purple-50 text-purple-700',
  date: 'bg-green-50 text-green-700',
  email: 'bg-red-50 text-red-700',
  url: 'bg-indigo-50 text-indigo-700',
  id: 'bg-yellow-50 text-yellow-700',
  unknown: 'bg-gray-100 text-gray-500',
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the human-in-the-loop schema field review form.
 * Users can accept/reject fields, rename them, and mark PII.
 *
 * @param entityType         - Discovered entity type name (editable)
 * @param fields             - Auto-discovered fields to review
 * @param onConfirm          - Called with final decisions when user submits
 * @param onEntityTypeChange - Notified when the entity type name changes
 */
export function SchemaFieldMapper({
  entityType: initialEntityType,
  fields: initialFields,
  onConfirm,
  onEntityTypeChange,
}: SchemaFieldMapperProps): React.JSX.Element {
  const [entityType, setEntityType] = useState(initialEntityType);
  const [decisions, setDecisions] = useState<SchemaFieldDecision[]>(
    initialFields.map(f => ({
      originalName: f.name,
      accepted: f.accepted,
      isPii: f.isPii,
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (fieldName: string, patch: Partial<SchemaFieldDecision>) => {
    setDecisions(prev =>
      prev.map(d => (d.originalName === fieldName ? { ...d, ...patch } : d)),
    );
  };

  const handleEntityTypeChange = (val: string) => {
    setEntityType(val);
    onEntityTypeChange?.(val);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(entityType, decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const acceptedCount = decisions.filter(d => d.accepted).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
              Entity Type Name
            </label>
            <input
              type="text"
              value={entityType}
              onChange={e => handleEntityTypeChange(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500">
              {acceptedCount} of {decisions.length} fields accepted
            </p>
          </div>
        </div>
      </div>

      {/* Field table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 w-8">Use</th>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Rename to</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Samples</th>
              <th className="px-4 py-3 w-16">Null%</th>
              <th className="px-4 py-3 w-16">PII</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {initialFields.map((field, i) => {
              const decision = decisions[i]!;
              return (
                <tr
                  key={field.name}
                  className={decision.accepted ? '' : 'opacity-40'}
                >
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={decision.accepted}
                      onChange={e => update(field.name, { accepted: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-800">{field.name}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      disabled={!decision.accepted}
                      placeholder={field.name}
                      value={decision.renamedTo ?? ''}
                      onChange={e => {
                        const val = e.target.value;
                        if (val) {
                          update(field.name, { renamedTo: val });
                        } else {
                          setDecisions(prev =>
                            prev.map(d => {
                              if (d.originalName !== field.name) return d;
                              const { renamedTo: _, ...rest } = d;
                              return rest as SchemaFieldDecision;
                            }),
                          );
                        }
                      }}
                      className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[field.inferredType]}`}
                    >
                      {field.inferredType}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate">
                    {field.sampleValues.slice(0, 3).join(', ')}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums text-gray-500">
                    {Math.round(field.nullRate * 100)}%
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      checked={decision.isPii}
                      onChange={e => update(field.name, { isPii: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 px-6 py-4">
        {error && (
          <p className="mb-3 text-sm text-red-600">{error}</p>
        )}
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            Fields marked as PII will be excluded from AI context and embedding inputs.
          </p>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || acceptedCount === 0 || !entityType.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? 'Confirming…' : `Confirm ${acceptedCount} field${acceptedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
