'use client';

import { useState } from 'react';

type TestCase = {
  formula: string;
  expectedRange?: [number, number];
  result?: number | null;
  passed?: boolean;
  error?: string;
};

type Props = {
  formula: string;
  workspaceId: string;
};

/**
 * Test panel for running formula validation and showing expected vs. actual behaviour.
 * Uses the validate-formula endpoint to check syntax and logs test case results.
 *
 * @param formula - Formula to test
 * @param workspaceId - Workspace scope
 */
export function MetricTestPanel({ formula, workspaceId }: Props) {
  const [cases, setCases] = useState<TestCase[]>([{ formula: formula || '' }]);
  const [running, setRunning] = useState(false);

  function addCase() {
    setCases((prev) => [...prev, { formula }]);
  }

  function updateCase(idx: number, updates: Partial<TestCase>) {
    setCases((prev) => prev.map((c, i) => (i === idx ? { ...c, ...updates } : c)));
  }

  async function runAll() {
    setRunning(true);
    const updated = await Promise.all(
      cases.map(async (tc) => {
        try {
          const res = await fetch('/api/v1/metrics/validate-formula', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
            body: JSON.stringify({ formula: tc.formula }),
          });
          const json = await res.json() as { data: { valid: boolean; error?: string } };
          if (!json.data.valid) return { ...tc, passed: false, error: json.data.error };
          return { ...tc, passed: true, result: null };
        } catch {
          return { ...tc, passed: false, error: 'Request failed' };
        }
      }),
    );
    setCases(updated);
    setRunning(false);
  }

  const passCount = cases.filter((c) => c.passed === true).length;
  const failCount = cases.filter((c) => c.passed === false).length;

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {cases.length} test case{cases.length !== 1 ? 's' : ''}
          {passCount + failCount > 0 && ` — ${passCount} passed, ${failCount} failed`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={addCase} style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 12 }}>
            + Add test
          </button>
          <button
            onClick={() => void runAll()}
            disabled={running}
            style={{ padding: '5px 10px', background: running ? '#e5e7eb' : '#6366f1', color: running ? '#9ca3af' : '#fff', border: 'none', borderRadius: 4, cursor: running ? 'not-allowed' : 'pointer', fontSize: 12 }}
          >
            {running ? 'Running…' : 'Run all'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cases.map((tc, i) => (
          <div
            key={i}
            style={{
              border: `1px solid ${tc.passed === true ? '#10b981' : tc.passed === false ? '#ef4444' : '#e5e7eb'}`,
              borderRadius: 6,
              padding: 10,
              background: tc.passed === true ? '#f0fdf4' : tc.passed === false ? '#fef2f2' : '#fff',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#6b7280', minWidth: 20 }}>#{i + 1}</span>
              <input
                value={tc.formula}
                onChange={(e) => updateCase(i, { formula: e.target.value })}
                style={{ flex: 1, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' }}
                placeholder="Formula to test"
              />
              {tc.passed !== undefined && (
                <span style={{ fontSize: 12, fontWeight: 600, color: tc.passed ? '#10b981' : '#ef4444' }}>
                  {tc.passed ? '✓ Pass' : '✗ Fail'}
                </span>
              )}
            </div>
            {tc.error && (
              <div style={{ marginTop: 4, fontSize: 11, color: '#ef4444', paddingLeft: 28 }}>{tc.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
