'use client';

import { useState, useEffect, useRef } from 'react';

type ValidationResult = {
  valid: boolean;
  error?: string;
  tokenCount?: number;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  workspaceId: string;
};

const EXAMPLES = [
  'SUM(revenue) / COUNT(customers)',
  'AVG(deal_amount)',
  'COUNT(contacts)',
  'SUM(mrr) - SUM(churn)',
];

const FUNCTIONS = ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX'];

/**
 * Formula editor with syntax hints, validation, and autocomplete for metric formulas.
 *
 * @param value - Current formula string
 * @param onChange - Called when formula changes
 * @param workspaceId - Workspace scope (used for validation API)
 */
export function MetricFormulaEditor({ value, onChange, workspaceId }: Props) {
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!value.trim()) { setValidation(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setValidating(true);
      fetch('/api/v1/metrics/validate-formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ formula: value }),
      })
        .then(async (r) => {
          const json = await r.json() as { data: ValidationResult };
          setValidation(json.data);
        })
        .catch(() => setValidation({ valid: false, error: 'Validation request failed' }))
        .finally(() => setValidating(false));
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, workspaceId]);

  const borderColor = !validation ? '#d1d5db' : validation.valid ? '#10b981' : '#ef4444';

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. SUM(revenue) / COUNT(customers)"
          rows={3}
          style={{
            width: '100%',
            padding: '8px 12px',
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            fontSize: 14,
            fontFamily: 'monospace',
            resize: 'vertical',
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />
        {validating && (
          <div style={{ position: 'absolute', right: 8, top: 8, fontSize: 11, color: '#9ca3af' }}>validating…</div>
        )}
      </div>

      {validation && (
        <div style={{ marginTop: 6, fontSize: 12, color: validation.valid ? '#10b981' : '#ef4444' }}>
          {validation.valid
            ? `Valid formula (${validation.tokenCount} tokens)`
            : `Invalid: ${validation.error}`}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>Available functions:</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {FUNCTIONS.map((fn) => (
            <code
              key={fn}
              style={{ fontSize: 11, padding: '2px 6px', background: '#f3f4f6', borderRadius: 4, cursor: 'pointer', color: '#6366f1' }}
              onClick={() => onChange(value + fn + '()')}
            >
              {fn}()
            </code>
          ))}
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>Examples:</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onChange(ex)}
              style={{
                textAlign: 'left',
                padding: '4px 8px',
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'monospace',
                color: '#374151',
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
