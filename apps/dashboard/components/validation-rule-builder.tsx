'use client';

import { useState, useEffect } from 'react';

type RuleType =
  | 'required'
  | 'type'
  | 'regex'
  | 'email'
  | 'phone'
  | 'min_length'
  | 'max_length'
  | 'enum'
  | 'range'
  | 'cross_field';

type StoredRule = {
  ruleId: string;
  entityType: string;
  ruleName: string;
  definition: Record<string, unknown>;
  isBlocking: boolean;
  severity: 'error' | 'warning';
  createdAt: string;
};

interface ValidationRuleBuilderProps {
  workspaceId: string;
}

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: 'required', label: 'Required field' },
  { value: 'email', label: 'Email format' },
  { value: 'phone', label: 'Phone format' },
  { value: 'type', label: 'Field type' },
  { value: 'regex', label: 'Regex pattern' },
  { value: 'enum', label: 'Allowed values (enum)' },
  { value: 'range', label: 'Numeric range' },
  { value: 'min_length', label: 'Min length' },
  { value: 'max_length', label: 'Max length' },
  { value: 'cross_field', label: 'Cross-field dependency' },
];

/**
 * Rule builder UI — lets users create, preview, and delete validation rules
 * for entity types without writing code.
 */
export function ValidationRuleBuilder({ workspaceId }: ValidationRuleBuilderProps) {
  const [rules, setRules] = useState<StoredRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    entityType: '',
    ruleName: '',
    ruleType: 'required' as RuleType,
    field: '',
    expectedType: 'string',
    pattern: '',
    allowedValues: '',
    minVal: '',
    maxVal: '',
    minLen: '',
    maxLen: '',
    isBlocking: true,
    severity: 'error' as 'error' | 'warning',
    conditionField: '',
    conditionOperator: 'eq' as string,
    conditionValue: '',
    requirementField: '',
    requirementOperator: 'exists' as string,
    requirementMessage: '',
  });

  useEffect(() => {
    void fetchRules();
  }, [workspaceId]);

  async function fetchRules() {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/validation/rules?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const json = await res.json() as { data: StoredRule[] };
      setRules(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function buildDefinition(): Record<string, unknown> {
    switch (form.ruleType) {
      case 'required': return { type: 'required', field: form.field };
      case 'email': return { type: 'email', field: form.field };
      case 'phone': return { type: 'phone', field: form.field };
      case 'type': return { type: 'type', field: form.field, expectedType: form.expectedType };
      case 'regex': return { type: 'regex', field: form.field, pattern: form.pattern };
      case 'enum': return {
        type: 'enum',
        field: form.field,
        allowedValues: form.allowedValues.split(',').map(s => s.trim()).filter(Boolean),
      };
      case 'range': return {
        type: 'range',
        field: form.field,
        ...(form.minVal !== '' ? { min: Number(form.minVal) } : {}),
        ...(form.maxVal !== '' ? { max: Number(form.maxVal) } : {}),
      };
      case 'min_length': return { type: 'min_length', field: form.field, minLength: Number(form.minLen) };
      case 'max_length': return { type: 'max_length', field: form.field, maxLength: Number(form.maxLen) };
      case 'cross_field': return {
        type: 'cross_field',
        condition: {
          field: form.conditionField,
          operator: form.conditionOperator,
          value: form.conditionValue || undefined,
        },
        requirement: {
          field: form.requirementField,
          operator: form.requirementOperator,
          message: form.requirementMessage || undefined,
        },
      };
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/v1/validation/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: form.entityType,
          ruleName: form.ruleName,
          definition: buildDefinition(),
          isBlocking: form.isBlocking,
          severity: form.severity,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: { message: string } };
        throw new Error(err.error?.message ?? 'Unknown error');
      }
      setShowForm(false);
      void fetchRules();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete(ruleId: string) {
    if (!confirm('Delete this rule?')) return;
    await fetch(`/api/v1/validation/rules/${ruleId}`, { method: 'DELETE' });
    void fetchRules();
  }

  const f = form;
  const setF = (patch: Partial<typeof form>) => setForm(prev => ({ ...prev, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Validation Rules</h2>
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
          <h3 className="font-medium text-sm">New Validation Rule</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Entity Type</label>
              <input
                required
                value={f.entityType}
                onChange={e => setF({ entityType: e.target.value })}
                placeholder="contact"
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Rule Name</label>
              <input
                required
                value={f.ruleName}
                onChange={e => setF({ ruleName: e.target.value })}
                placeholder="Email is required"
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Rule Type</label>
              <select
                value={f.ruleType}
                onChange={e => setF({ ruleType: e.target.value as RuleType })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              >
                {RULE_TYPES.map(rt => (
                  <option key={rt.value} value={rt.value}>{rt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Severity</label>
              <select
                value={f.severity}
                onChange={e => setF({ severity: e.target.value as 'error' | 'warning' })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              >
                <option value="error">Error (blocking when isBlocking=true)</option>
                <option value="warning">Warning (non-blocking)</option>
              </select>
            </div>
          </div>

          {f.ruleType !== 'cross_field' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Field Name</label>
              <input
                required
                value={f.field}
                onChange={e => setF({ field: e.target.value })}
                placeholder="email"
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          )}

          {f.ruleType === 'type' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Expected Type</label>
              <select
                value={f.expectedType}
                onChange={e => setF({ expectedType: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              >
                {['string', 'number', 'boolean', 'array'].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}

          {f.ruleType === 'regex' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Pattern (RegExp)</label>
              <input
                required
                value={f.pattern}
                onChange={e => setF({ pattern: e.target.value })}
                placeholder="^ACC-\d{4}$"
                className="w-full border border-border rounded px-2 py-1.5 text-sm font-mono"
              />
            </div>
          )}

          {f.ruleType === 'enum' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Allowed Values (comma-separated)
              </label>
              <input
                required
                value={f.allowedValues}
                onChange={e => setF({ allowedValues: e.target.value })}
                placeholder="active, inactive, closed"
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          )}

          {f.ruleType === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Min (optional)</label>
                <input
                  type="number"
                  value={f.minVal}
                  onChange={e => setF({ minVal: e.target.value })}
                  className="w-full border border-border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Max (optional)</label>
                <input
                  type="number"
                  value={f.maxVal}
                  onChange={e => setF({ maxVal: e.target.value })}
                  className="w-full border border-border rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          {f.ruleType === 'min_length' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Min Length</label>
              <input
                required
                type="number"
                min={1}
                value={f.minLen}
                onChange={e => setF({ minLen: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          )}

          {f.ruleType === 'max_length' && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Max Length</label>
              <input
                required
                type="number"
                min={1}
                value={f.maxLen}
                onChange={e => setF({ maxLen: e.target.value })}
                className="w-full border border-border rounded px-2 py-1.5 text-sm"
              />
            </div>
          )}

          {f.ruleType === 'cross_field' && (
            <div className="space-y-3 rounded border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Condition (when this is true…)</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  required
                  placeholder="field"
                  value={f.conditionField}
                  onChange={e => setF({ conditionField: e.target.value })}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                />
                <select
                  value={f.conditionOperator}
                  onChange={e => setF({ conditionOperator: e.target.value })}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                >
                  {['eq', 'neq', 'exists', 'not_exists'].map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                <input
                  placeholder="value (optional)"
                  value={f.conditionValue}
                  onChange={e => setF({ conditionValue: e.target.value })}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                />
              </div>
              <p className="text-xs font-medium text-muted-foreground">…then this must hold</p>
              <div className="grid grid-cols-3 gap-2">
                <input
                  required
                  placeholder="field"
                  value={f.requirementField}
                  onChange={e => setF({ requirementField: e.target.value })}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                />
                <select
                  value={f.requirementOperator}
                  onChange={e => setF({ requirementOperator: e.target.value })}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                >
                  {['exists', 'not_exists', 'eq', 'neq'].map(op => (
                    <option key={op} value={op}>{op}</option>
                  ))}
                </select>
                <input
                  placeholder="error message (optional)"
                  value={f.requirementMessage}
                  onChange={e => setF({ requirementMessage: e.target.value })}
                  className="border border-border rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isBlocking"
              checked={f.isBlocking}
              onChange={e => setF({ isBlocking: e.target.checked })}
              className="rounded"
            />
            <label htmlFor="isBlocking" className="text-sm">
              Blocking (reject entity if this rule fails)
            </label>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 border border-border rounded text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-sm"
            >
              Create Rule
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="text-sm text-muted-foreground">Loading rules…</div>
      )}

      {!loading && rules.length === 0 && !showForm && (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No validation rules yet. Click &ldquo;+ New Rule&rdquo; to add one.
        </div>
      )}

      {rules.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Rule Name</th>
                <th className="text-left px-4 py-2 font-medium">Entity Type</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Severity</th>
                <th className="text-left px-4 py-2 font-medium">Blocking</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.ruleId} className="border-t border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2 font-medium">{rule.ruleName}</td>
                  <td className="px-4 py-2">
                    <code className="text-xs bg-muted px-1 rounded">{rule.entityType}</code>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {String(rule.definition?.['type'] ?? '—')}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        rule.severity === 'error'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {rule.severity}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {rule.isBlocking ? (
                      <span className="text-xs text-destructive">Yes</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => void handleDelete(rule.ruleId)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Delete
                    </button>
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
