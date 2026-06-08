'use client';

import { useState, useCallback, useId } from 'react';
import { FilterRuleEditor } from './filter-rule-editor.js';
import type { FilterRule, FilterOperator } from './filter-rule-editor.js';
import { getAttributesForType } from './attribute-picker.js';
import { QueryPreview } from './query-preview.js';
import type { AggregationFn, AggregationConfig } from './query-preview.js';
import { buildQueryString } from './query-preview.js';

interface AdvancedQueryBuilderProps {
  workspaceId: string;
  availableEntityTypes?: string[];
  onClose?: () => void;
  apiBase?: string;
}

const AGGREGATION_FNS: AggregationFn[] = ['count', 'sum', 'avg', 'min', 'max'];
const DEFAULT_ENTITY_TYPES = ['contact', 'company', 'deal', 'issue', 'document', 'activity'];

function createRule(id: string): FilterRule {
  return { id, field: '', operator: '=' as FilterOperator, value: '' };
}

function nextId(prefix = 'r'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

interface QueryResult {
  entities?: unknown[];
  aggregation?: unknown;
  totalCount?: number;
  truncated?: boolean;
  filterSyntax?: string;
}

export function AdvancedQueryBuilder({
  workspaceId,
  availableEntityTypes = DEFAULT_ENTITY_TYPES,
  onClose,
  apiBase = '/api/v1',
}: AdvancedQueryBuilderProps) {
  const formId = useId();
  const [entityType, setEntityType] = useState('');
  const [rules, setRules] = useState<FilterRule[]>([createRule(nextId())]);
  const [aggregation, setAggregation] = useState<AggregationConfig>({ fn: 'count', field: '', groupBy: '' });
  const [useAggregation, setUseAggregation] = useState(false);
  const [limit, setLimit] = useState(20);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableFields = getAttributesForType(entityType);

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, createRule(nextId())]);
  }, []);

  const updateRule = useCallback((id: string, updated: FilterRule) => {
    setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }, []);

  const removeRule = useCallback((id: string) => {
    setRules((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length === 0 ? [createRule(nextId())] : next;
    });
  }, []);

  const hasInvalidRules = rules.some((r) => r.field && !r.value);

  const handleExecute = useCallback(async () => {
    if (!entityType) { setError('Select an entity type first'); return; }
    if (hasInvalidRules) { setError('All filter rules must have a value'); return; }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = {
        workspaceId,
        entityType,
        filters: rules.filter((r) => r.field && r.value).map((r) => ({
          field: r.field,
          operator: r.operator,
          value: r.operator === 'in'
            ? r.value.split(',').map((v) => v.trim())
            : r.value,
        })),
        ...(useAggregation && aggregation.fn ? {
          aggregation: {
            fn: aggregation.fn,
            field: aggregation.field || undefined,
            groupBy: aggregation.groupBy || undefined,
          },
        } : { limit }),
      };

      const res = await fetch(`${apiBase}/advanced-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json() as { data?: QueryResult; error?: { message: string } };

      if (!res.ok) {
        setError(data.error?.message ?? `HTTP ${res.status}`);
      } else {
        setResult(data.data ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, entityType, rules, useAggregation, aggregation, limit, apiBase, hasInvalidRules]);

  return (
    <div
      role="dialog"
      aria-labelledby={`${formId}-title`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        padding: '1.5rem',
        background: 'white',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
        maxWidth: '720px',
        width: '100%',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 id={`${formId}-title`} style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
          Advanced Query Builder
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close query builder"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1.25rem', lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>

      {/* Entity type selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <label htmlFor={`${formId}-entity-type`} style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569' }}>
          Entity Type
        </label>
        <select
          id={`${formId}-entity-type`}
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.875rem', background: 'white', maxWidth: '240px' }}
        >
          <option value="">Select entity type…</option>
          {availableEntityTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Filter rules */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569' }}>Filter Rules</span>
          <button
            onClick={addRule}
            style={{
              padding: '0.25rem 0.625rem',
              fontSize: '0.75rem',
              border: '1px solid #d1d5db',
              borderRadius: '0.375rem',
              background: 'white',
              cursor: 'pointer',
              color: '#3b82f6',
              fontWeight: 600,
            }}
          >
            + Add Rule
          </button>
        </div>
        {rules.map((rule) => (
          <FilterRuleEditor
            key={rule.id}
            rule={rule}
            availableFields={availableFields}
            onUpdate={(updated) => updateRule(rule.id, updated)}
            onRemove={() => removeRule(rule.id)}
          />
        ))}
        {hasInvalidRules && (
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#dc2626' }}>
            All filter rules with a field selected must have a value.
          </p>
        )}
      </div>

      {/* Aggregation toggle */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 500, color: '#475569' }}>
          <input
            type="checkbox"
            checked={useAggregation}
            onChange={(e) => setUseAggregation(e.target.checked)}
          />
          Aggregation
        </label>

        {useAggregation && (
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', paddingLeft: '1.25rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Function</label>
              <select
                value={aggregation.fn}
                onChange={(e) => setAggregation((a) => ({ ...a, fn: e.target.value as AggregationFn }))}
                style={{ padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8125rem' }}
              >
                {AGGREGATION_FNS.map((fn) => <option key={fn} value={fn}>{fn.toUpperCase()}</option>)}
              </select>
            </div>
            {aggregation.fn !== 'count' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Field</label>
                <select
                  value={aggregation.field}
                  onChange={(e) => setAggregation((a) => ({ ...a, field: e.target.value }))}
                  style={{ padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8125rem' }}
                >
                  <option value="">Select…</option>
                  {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Group By</label>
              <select
                value={aggregation.groupBy ?? ''}
                onChange={(e) => setAggregation((a) => ({ ...a, groupBy: e.target.value || undefined }))}
                style={{ padding: '0.375rem 0.625rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8125rem' }}
              >
                <option value="">None</option>
                {availableFields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        )}

        {!useAggregation && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '1.25rem' }}>
            <label htmlFor={`${formId}-limit`} style={{ fontSize: '0.75rem', color: '#64748b' }}>Limit</label>
            <input
              id={`${formId}-limit`}
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 20)))}
              style={{ width: '4rem', padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '0.375rem', fontSize: '0.8125rem' }}
            />
          </div>
        )}
      </div>

      {/* Query preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#475569' }}>Query Preview</span>
        <QueryPreview
          entityType={entityType}
          rules={rules}
          aggregation={useAggregation ? aggregation : undefined}
          limit={limit}
        />
      </div>

      {/* Execute button + error */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => { void handleExecute(); }}
          disabled={loading || !entityType}
          style={{
            padding: '0.5rem 1.25rem',
            background: !entityType || loading ? '#94a3b8' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.5rem',
            fontWeight: 700,
            fontSize: '0.875rem',
            cursor: !entityType || loading ? 'not-allowed' : 'pointer',
          }}
          aria-busy={loading}
        >
          {loading ? 'Running…' : 'Execute Query'}
        </button>
        {error && (
          <span style={{ fontSize: '0.8125rem', color: '#dc2626' }}>{error}</span>
        )}
      </div>

      {/* Results */}
      {result !== null && (
        <div
          style={{
            padding: '0.875rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '0.5rem',
            fontSize: '0.8125rem',
          }}
          aria-live="polite"
        >
          {result.aggregation !== undefined ? (
            <div>
              <strong>Aggregation result:</strong>
              <pre style={{ margin: '0.5rem 0 0', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(result.aggregation, null, 2)}
              </pre>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <strong>{result.totalCount ?? (result.entities?.length ?? 0)} results</strong>
                {result.truncated && <span style={{ color: '#d97706' }}>Results truncated</span>}
              </div>
              <p style={{ margin: 0, color: '#64748b' }}>
                Filter syntax: <code>{buildQueryString(entityType, rules, undefined, limit)}</code>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
