'use client';

import { useState, useEffect, useCallback } from 'react';

interface AbTestResult {
  testId: string;
  recommendationId: string;
  status: 'running' | 'concluded';
  controlMetric: number;
  treatmentMetric: number;
  improvementPct: number;
  conclusionAt: string | null;
}

interface AbTestResultsPanelProps {
  workspaceId: string;
  testId: string;
  onConclude?: (result: AbTestResult) => void;
}

function MetricBar({ label, value, isHigher }: { label: string; value: number; isHigher: boolean }) {
  const pct = Math.min(value * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-600">{label}</span>
        <span className={`font-medium ${isHigher ? 'text-green-600' : 'text-gray-700'}`}>
          {value.toFixed(3)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full transition-all ${isHigher ? 'bg-green-500' : 'bg-blue-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Shows the results of an active or concluded A/B test for a tuning recommendation.
 */
export function AbTestResultsPanel({ workspaceId, testId, onConclude }: AbTestResultsPanelProps) {
  const [result, setResult] = useState<AbTestResult | null>(null);
  const [concluding, setConcluding] = useState(false);
  const [controlInput, setControlInput] = useState('');
  const [treatmentInput, setTreatmentInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleConclude = async () => {
    const control = parseFloat(controlInput);
    const treatment = parseFloat(treatmentInput);
    if (isNaN(control) || isNaN(treatment)) {
      setError('Both metric values must be valid numbers');
      return;
    }
    setConcluding(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/optimization/ab-tests/${encodeURIComponent(testId)}/conclude`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId, 'content-type': 'application/json' },
        body: JSON.stringify({ controlMetric: control, treatmentMetric: treatment }),
      });
      if (!res.ok) throw new Error(`Conclude failed: ${res.status}`);
      const json = (await res.json()) as { data: AbTestResult };
      setResult(json.data);
      onConclude?.(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conclude failed');
    } finally {
      setConcluding(false);
    }
  };

  if (!result) {
    return (
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-4">
        <h4 className="text-sm font-semibold text-blue-800">A/B Test Running</h4>
        <p className="text-xs text-blue-700">
          Test ID: <code className="font-mono">{testId}</code>
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-blue-800 mb-1">Control Metric</label>
            <input
              type="number"
              step="0.001"
              value={controlInput}
              onChange={(e) => setControlInput(e.target.value)}
              className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-sm"
              placeholder="0.750"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-blue-800 mb-1">Treatment Metric</label>
            <input
              type="number"
              step="0.001"
              value={treatmentInput}
              onChange={(e) => setTreatmentInput(e.target.value)}
              className="w-full rounded border border-blue-200 bg-white px-2 py-1 text-sm"
              placeholder="0.820"
            />
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="button"
          onClick={() => void handleConclude()}
          disabled={concluding}
          className="w-full rounded-md bg-blue-600 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {concluding ? 'Concluding…' : 'Conclude Test'}
        </button>
      </div>
    );
  }

  const improved = result.improvementPct >= 0;
  return (
    <div className={`rounded-lg border p-4 space-y-3 ${improved ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between">
        <h4 className={`text-sm font-semibold ${improved ? 'text-green-800' : 'text-red-800'}`}>
          {improved ? 'Test Passed — Recommendation Applied' : 'Test Failed — Change Rolled Back'}
        </h4>
        <span className={`text-lg font-bold ${improved ? 'text-green-700' : 'text-red-700'}`}>
          {result.improvementPct > 0 ? '+' : ''}{result.improvementPct.toFixed(1)}%
        </span>
      </div>

      <div className="space-y-2">
        <MetricBar
          label="Control (baseline)"
          value={result.controlMetric}
          isHigher={result.controlMetric >= result.treatmentMetric}
        />
        <MetricBar
          label="Treatment (change)"
          value={result.treatmentMetric}
          isHigher={result.treatmentMetric > result.controlMetric}
        />
      </div>

      {result.conclusionAt && (
        <p className={`text-xs ${improved ? 'text-green-600' : 'text-red-600'}`}>
          Concluded at {new Date(result.conclusionAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
