'use client';

import { useState } from 'react';

type TransformationStep = { op: string } & Record<string, unknown>;

type TestResult = {
  input: { attributes: Record<string, unknown> };
  output: { attributes: Record<string, unknown> };
  stepsApplied: number;
  transformedFields: string[];
};

interface TransformationTestPanelProps {
  workspaceId: string;
}

const EXAMPLE_ENTITY = JSON.stringify(
  {
    id: 'contact:example',
    type: 'contact',
    label: 'Alice Smith',
    attributes: {
      firstName: '  ALICE  ',
      lastName: 'smith',
      email: 'ALICE@EXAMPLE.COM',
      phone: '+1 (555) 000-1234',
      status: '1',
    },
  },
  null,
  2
);

const EXAMPLE_STEPS = JSON.stringify(
  [
    { op: 'trim', field: 'firstName' },
    { op: 'normalize_case', field: 'firstName', mode: 'title' },
    { op: 'normalize_case', field: 'email', mode: 'lower' },
    { op: 'map_value', field: 'status', mapping: { '1': 'active', '0': 'inactive' } },
  ],
  null,
  2
);

/**
 * Live preview panel for testing transformation steps against a sample entity.
 */
export function TransformationTestPanel({ workspaceId: _workspaceId }: TransformationTestPanelProps) {
  const [entityJson, setEntityJson] = useState(EXAMPLE_ENTITY);
  const [stepsJson, setStepsJson] = useState(EXAMPLE_STEPS);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runTest() {
    setError(null);
    setResult(null);

    let entity: unknown;
    let steps: TransformationStep[];

    try {
      entity = JSON.parse(entityJson);
    } catch {
      setError('Invalid entity JSON');
      return;
    }

    try {
      steps = JSON.parse(stepsJson) as TransformationStep[];
    } catch {
      setError('Invalid steps JSON');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/transformations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, steps }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: { message: string } };
        throw new Error(err.error?.message ?? 'Unknown error');
      }
      const json = await res.json() as { data: TestResult };
      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Live Transformation Test</h2>
        <button
          onClick={() => void runTest()}
          disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
        >
          {loading ? 'Running…' : 'Run Test'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Sample Entity (JSON)
          </label>
          <textarea
            value={entityJson}
            onChange={e => setEntityJson(e.target.value)}
            rows={14}
            className="w-full border border-border rounded px-3 py-2 text-xs font-mono resize-none"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Transformation Steps (JSON array)
          </label>
          <textarea
            value={stepsJson}
            onChange={e => setStepsJson(e.target.value)}
            rows={14}
            className="w-full border border-border rounded px-3 py-2 text-xs font-mono resize-none"
            spellCheck={false}
          />
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">Result</span>
            <span className="text-xs text-muted-foreground">
              {result.stepsApplied} step(s) applied ·{' '}
              {result.transformedFields.length} field(s) changed:{' '}
              {result.transformedFields.map(f => (
                <code key={f} className="bg-muted px-1 rounded text-xs mx-0.5">{f}</code>
              ))}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Before</p>
              <div className="rounded border border-border p-3 bg-muted/30">
                <pre className="text-xs overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(result.input.attributes, null, 2)}
                </pre>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">After</p>
              <div className="rounded border border-green-200 p-3 bg-green-50/50">
                <pre className="text-xs overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(result.output.attributes, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
