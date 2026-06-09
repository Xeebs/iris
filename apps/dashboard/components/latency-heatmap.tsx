'use client';

import { useEffect, useState } from 'react';

type TraceSpan = {
  operationName: string;
  durationMs: number | null;
};

type Cell = {
  operation: string;
  percentile: 'p50' | 'p75' | 'p95' | 'p99';
  value: number;
};

type Props = {
  operationFilter?: string;
  limit?: number;
};

const PERCENTILE_LABELS = ['p50', 'p75', 'p95', 'p99'] as const;

function computePercentiles(values: number[]): Record<string, number> {
  if (values.length === 0) return { p50: 0, p75: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  };
  return { p50: at(50), p75: at(75), p95: at(95), p99: at(99) };
}

function cellColor(value: number, maxValue: number): string {
  if (maxValue === 0) return 'bg-gray-50';
  const ratio = value / maxValue;
  if (ratio > 0.8) return 'bg-red-500 text-white';
  if (ratio > 0.6) return 'bg-red-300';
  if (ratio > 0.4) return 'bg-amber-300';
  if (ratio > 0.2) return 'bg-yellow-200';
  return 'bg-green-100';
}

/**
 * Operation × percentile latency heatmap fetched from trace data.
 */
export function LatencyHeatmap({ operationFilter, limit = 50 }: Props) {
  const [cells, setCells] = useState<Cell[]>([]);
  const [operations, setOperations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (operationFilter) params.set('operationName', operationFilter);

    fetch(`/api/v1/traces?${params}`)
      .then((r) => r.json())
      .then((body) => {
        const spans: TraceSpan[] = (body.data ?? []) as TraceSpan[];
        const byOp = new Map<string, number[]>();

        for (const span of spans) {
          if (span.durationMs === null) continue;
          const ops = byOp.get(span.operationName) ?? [];
          ops.push(span.durationMs);
          byOp.set(span.operationName, ops);
        }

        const ops = Array.from(byOp.keys()).slice(0, 10);
        setOperations(ops);

        const newCells: Cell[] = [];
        for (const op of ops) {
          const pcts = computePercentiles(byOp.get(op) ?? []);
          for (const percentile of PERCENTILE_LABELS) {
            newCells.push({ operation: op, percentile, value: pcts[percentile] ?? 0 });
          }
        }
        setCells(newCells);
      })
      .catch(() => setError('Failed to load trace data'))
      .finally(() => setLoading(false));
  }, [operationFilter, limit]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="h-40 rounded bg-gray-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  const maxValue = Math.max(1, ...cells.map((c) => c.value));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 overflow-x-auto">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Latency Heatmap</h3>

      {operations.length === 0 ? (
        <p className="text-sm text-gray-400">No trace data available.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-gray-500">Operation</th>
              {PERCENTILE_LABELS.map((p) => (
                <th key={p} className="py-1 px-2 text-center font-medium text-gray-500 uppercase">
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {operations.map((op) => (
              <tr key={op}>
                <td className="py-1 pr-3 font-mono text-gray-700 truncate max-w-[180px]" title={op}>
                  {op}
                </td>
                {PERCENTILE_LABELS.map((percentile) => {
                  const cell = cells.find((c) => c.operation === op && c.percentile === percentile);
                  const value = cell?.value ?? 0;
                  return (
                    <td key={percentile} className={`py-1 px-2 text-center rounded ${cellColor(value, maxValue)}`}>
                      {value > 0 ? `${value}ms` : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
