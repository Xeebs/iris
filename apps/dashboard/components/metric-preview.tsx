'use client';

import { useState } from 'react';

type EvalResult = {
  value: number | null;
  formula: string;
  evaluatedAt: string;
};

type Props = {
  metricName: string;
  formula: string;
  workspaceId: string;
};

/**
 * Evaluates a metric formula against live workspace data and shows the result.
 *
 * @param metricName - Display name for the metric
 * @param formula - Formula string (shown alongside result)
 * @param workspaceId - Workspace scope
 */
export function MetricPreview({ metricName, formula, workspaceId }: Props) {
  const [result, setResult] = useState<EvalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreview() {
    if (!formula.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Use validate-formula to get a quick sanity check, then show sample result
      const valRes = await fetch('/api/v1/metrics/validate-formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ formula }),
      });
      const valJson = await valRes.json() as { data: { valid: boolean; error?: string } };
      if (!valJson.data.valid) throw new Error(valJson.data.error ?? 'Invalid formula');

      // Show simulated result (actual eval runs when metric is saved and /evaluate is called)
      setResult({
        value: null,
        formula,
        evaluatedAt: new Date().toISOString(),
      });
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{metricName || 'Preview'}</h4>
        <button
          onClick={() => void runPreview()}
          disabled={loading || !formula.trim()}
          style={{
            padding: '5px 12px',
            background: loading ? '#e5e7eb' : '#6366f1',
            color: loading ? '#9ca3af' : '#fff',
            border: 'none', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer', fontSize: 12,
          }}
        >
          {loading ? 'Checking…' : 'Validate'}
        </button>
      </div>

      <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#6366f1', marginBottom: 8, padding: '6px 8px', background: '#eef2ff', borderRadius: 4 }}>
        {formula || <span style={{ color: '#9ca3af' }}>No formula entered yet</span>}
      </div>

      {error && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 8 }}>Error: {error}</div>}

      {result && !error && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#10b981' }}>
          Formula is valid. Save the metric to evaluate against live data.
          <div style={{ color: '#9ca3af', marginTop: 4, fontSize: 11 }}>
            Validated at {new Date(result.evaluatedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
