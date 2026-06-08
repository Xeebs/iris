'use client';

import { useState, useEffect } from 'react';

type OpType =
  | 'rename'
  | 'remove'
  | 'keep_only'
  | 'normalize_case'
  | 'trim'
  | 'regex_replace'
  | 'concat'
  | 'extract_substring'
  | 'format_date'
  | 'set_default'
  | 'map_value';

type TransformationStep = { op: OpType } & Record<string, unknown>;

type StoredRule = {
  ruleId: string;
  connectorId: string | undefined;
  entityType: string | undefined;
  ruleName: string;
  steps: TransformationStep[];
  isActive: boolean;
  createdAt: string;
};

interface TransformationRuleEditorProps {
  workspaceId: string;
}

const OP_LABELS: Record<OpType, string> = {
  rename: 'Rename field',
  remove: 'Remove field',
  keep_only: 'Keep only specific fields',
  normalize_case: 'Normalize case',
  trim: 'Trim whitespace',
  regex_replace: 'Regex replace',
  concat: 'Concatenate fields',
  extract_substring: 'Extract substring',
  format_date: 'Format date',
  set_default: 'Set default value',
  map_value: 'Map value (enum replacement)',
};

/**
 * Lets users create, view, and delete transformation rule chains.
 */
export function TransformationRuleEditor({ workspaceId }: TransformationRuleEditorProps) {
  const [rules, setRules] = useState<StoredRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    ruleName: '',
    connectorId: '',
    entityType: '',
    op: 'rename' as OpType,
    field: '',
    toField: '',
    caseMode: 'lower',
    keepFields: '',
    pattern: '',
    replacement: '',
    concatFields: '',
    separator: ' ',
    targetField: '',
    substringStart: '0',
    substringEnd: '',
    dateFormat: 'iso',
    defaultValue: '',
    mapFrom: '',
    mapTo: '',
  });
  const [steps, setSteps] = useState<TransformationStep[]>([]);

  useEffect(() => {
    void fetchRules();
  }, [workspaceId]);

  async function fetchRules() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/transformations/rules?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const json = await res.json() as { data: StoredRule[] };
      setRules(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function buildStep(): TransformationStep | null {
    const { op, field, toField, caseMode, keepFields, pattern, replacement,
      concatFields, separator, targetField, substringStart, substringEnd,
      dateFormat, defaultValue, mapFrom, mapTo } = form;

    switch (op) {
      case 'rename': return field && toField ? { op, from: field, to: toField } : null;
      case 'remove': return field ? { op, field } : null;
      case 'keep_only': return keepFields ? { op, fields: keepFields.split(',').map(s => s.trim()) } : null;
      case 'normalize_case': return field ? { op, field, mode: caseMode } : null;
      case 'trim': return field ? { op, field } : null;
      case 'regex_replace': return field && pattern ? { op, field, pattern, replacement, flags: 'g' } : null;
      case 'concat': return concatFields && targetField
        ? { op, fields: concatFields.split(',').map(s => s.trim()), separator, targetField }
        : null;
      case 'extract_substring': return field
        ? {
            op,
            field,
            start: Number(substringStart),
            ...(substringEnd ? { end: Number(substringEnd) } : {}),
            ...(targetField ? { targetField } : {}),
          }
        : null;
      case 'format_date': return field ? { op, field, format: dateFormat } : null;
      case 'set_default': return field && defaultValue !== '' ? { op, field, defaultValue } : null;
      case 'map_value': return field && mapFrom && mapTo
        ? { op, field, mapping: { [mapFrom]: mapTo } }
        : null;
    }
  }

  function addStep() {
    const step = buildStep();
    if (!step) { setError('Fill in all required fields for this step type.'); return; }
    setSteps(prev => [...prev, step]);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (steps.length === 0) { setError('Add at least one transformation step.'); return; }
    setError(null);
    try {
      const res = await fetch('/api/v1/transformations/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleName: form.ruleName,
          connectorId: form.connectorId || undefined,
          entityType: form.entityType || undefined,
          steps,
          isActive: true,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowForm(false);
      setSteps([]);
      void fetchRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(ruleId: string) {
    if (!confirm('Delete this rule?')) return;
    await fetch(`/api/v1/transformations/rules/${ruleId}`, { method: 'DELETE' });
    void fetchRules();
  }

  const f = form;
  const setF = (patch: Partial<typeof form>) => setForm(prev => ({ ...prev, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transformation Rules</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm"
        >
          {showForm ? 'Cancel' : '+ New Rule'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={(e) => void handleSubmit(e)} className="rounded-lg border border-border p-4 space-y-4">
          <h3 className="font-medium text-sm">New Transformation Rule</h3>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Rule Name</label>
              <input required value={f.ruleName} onChange={e => setF({ ruleName: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
                placeholder="Normalize contact fields" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Connector ID (optional)</label>
              <input value={f.connectorId} onChange={e => setF({ connectorId: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
                placeholder="hubspot" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Entity Type (optional)</label>
              <input value={f.entityType} onChange={e => setF({ entityType: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
                placeholder="contact" />
            </div>
          </div>

          <div className="rounded border border-border p-3 space-y-3">
            <h4 className="text-xs font-medium text-muted-foreground">Add Step</h4>
            <div>
              <select value={f.op} onChange={e => setF({ op: e.target.value as OpType })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm">
                {Object.entries(OP_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {['rename', 'remove', 'normalize_case', 'trim', 'regex_replace',
              'extract_substring', 'format_date', 'set_default', 'map_value'].includes(f.op) && (
              <input value={f.field} onChange={e => setF({ field: e.target.value })}
                placeholder="Field name" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
            )}

            {f.op === 'rename' && (
              <input value={f.toField} onChange={e => setF({ toField: e.target.value })}
                placeholder="New field name" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
            )}
            {f.op === 'keep_only' && (
              <input value={f.keepFields} onChange={e => setF({ keepFields: e.target.value })}
                placeholder="field1, field2, field3" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
            )}
            {f.op === 'normalize_case' && (
              <select value={f.caseMode} onChange={e => setF({ caseMode: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm">
                <option value="lower">lower</option>
                <option value="upper">UPPER</option>
                <option value="title">Title Case</option>
              </select>
            )}
            {f.op === 'regex_replace' && (
              <>
                <input value={f.pattern} onChange={e => setF({ pattern: e.target.value })}
                  placeholder="Pattern" className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono" />
                <input value={f.replacement} onChange={e => setF({ replacement: e.target.value })}
                  placeholder="Replacement" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
              </>
            )}
            {f.op === 'concat' && (
              <>
                <input value={f.concatFields} onChange={e => setF({ concatFields: e.target.value })}
                  placeholder="field1, field2" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={f.separator} onChange={e => setF({ separator: e.target.value })}
                    placeholder="Separator" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
                  <input value={f.targetField} onChange={e => setF({ targetField: e.target.value })}
                    placeholder="Target field" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
                </div>
              </>
            )}
            {f.op === 'extract_substring' && (
              <div className="grid grid-cols-3 gap-2">
                <input type="number" value={f.substringStart} onChange={e => setF({ substringStart: e.target.value })}
                  placeholder="Start" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
                <input type="number" value={f.substringEnd} onChange={e => setF({ substringEnd: e.target.value })}
                  placeholder="End (optional)" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
                <input value={f.targetField} onChange={e => setF({ targetField: e.target.value })}
                  placeholder="Target (optional)" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
              </div>
            )}
            {f.op === 'format_date' && (
              <select value={f.dateFormat} onChange={e => setF({ dateFormat: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm">
                <option value="iso">ISO 8601</option>
                <option value="short">Short (M/D/YYYY)</option>
                <option value="epoch_ms">Epoch milliseconds</option>
              </select>
            )}
            {f.op === 'set_default' && (
              <input value={f.defaultValue} onChange={e => setF({ defaultValue: e.target.value })}
                placeholder="Default value" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
            )}
            {f.op === 'map_value' && (
              <div className="grid grid-cols-2 gap-2">
                <input value={f.mapFrom} onChange={e => setF({ mapFrom: e.target.value })}
                  placeholder="From value" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
                <input value={f.mapTo} onChange={e => setF({ mapTo: e.target.value })}
                  placeholder="To value" className="w-full border border-border rounded px-2 py-1.5 text-sm" />
              </div>
            )}

            <button type="button" onClick={addStep}
              className="px-3 py-1.5 border border-border rounded text-sm hover:bg-muted">
              + Add Step
            </button>
          </div>

          {steps.length > 0 && (
            <div className="rounded border border-border p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Steps ({steps.length})</p>
              {steps.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1">
                  <span className="font-mono text-xs bg-muted px-1.5 rounded">{s.op}</span>
                  <span className="text-muted-foreground text-xs ml-2 truncate">
                    {JSON.stringify(s)}
                  </span>
                  <button type="button" onClick={() => setSteps(prev => prev.filter((_, j) => j !== i))}
                    className="ml-2 text-destructive text-xs hover:underline">✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); setSteps([]); }}
              className="px-3 py-1.5 border border-border rounded text-sm">Cancel</button>
            <button type="submit" className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm">
              Save Rule
            </button>
          </div>
        </form>
      )}

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {!loading && rules.length === 0 && !showForm && (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No transformation rules yet. Click &ldquo;+ New Rule&rdquo; to create one.
        </div>
      )}

      {rules.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Rule Name</th>
                <th className="text-left px-4 py-2 font-medium">Connector</th>
                <th className="text-left px-4 py-2 font-medium">Entity Type</th>
                <th className="text-left px-4 py-2 font-medium">Steps</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.ruleId} className="border-t border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 font-medium">{rule.ruleName}</td>
                  <td className="px-4 py-2 text-muted-foreground">{rule.connectorId ?? '—'}</td>
                  <td className="px-4 py-2">
                    {rule.entityType
                      ? <code className="text-xs bg-muted px-1 rounded">{rule.entityType}</code>
                      : <span className="text-muted-foreground">all</span>
                    }
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{rule.steps.length}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => void handleDelete(rule.ruleId)}
                      className="text-xs text-destructive hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
