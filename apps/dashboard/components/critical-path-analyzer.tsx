'use client';

import { useEffect, useState } from 'react';

type TraceAnalysis = {
  traceId: string;
  totalSpans: number;
  totalDurationMs: number;
  criticalPath: string[];
  slowestOperations: Array<{ operationName: string; durationMs: number }>;
  errorCount: number;
};

type Props = {
  traceId: string;
};

/**
 * Displays the critical path and slowest operations for a distributed trace.
 */
export function CriticalPathAnalyzer({ traceId }: Props) {
  const [analysis, setAnalysis] = useState<TraceAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/traces/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ traceId }),
    })
      .then((r) => r.json())
      .then((body) => setAnalysis(body.data ?? null))
      .catch(() => setError('Failed to analyze trace'))
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 rounded-lg border border-gray-200 p-4">
        <div className="h-4 w-48 rounded bg-gray-100" />
        <div className="h-20 rounded bg-gray-100" />
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

  if (!analysis) return null;

  const maxSlowDuration = Math.max(1, ...analysis.slowestOperations.map((o) => o.durationMs));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Critical Path Analysis</h3>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{analysis.totalSpans} spans</span>
          <span>{analysis.totalDurationMs}ms total</span>
          {analysis.errorCount > 0 && (
            <span className="font-medium text-red-600">{analysis.errorCount} errors</span>
          )}
        </div>
      </div>

      {analysis.criticalPath.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">Critical Path</p>
          <div className="flex flex-wrap items-center gap-1">
            {analysis.criticalPath.map((op, idx) => (
              <span key={idx} className="flex items-center gap-1">
                {idx > 0 && <span className="text-gray-300">→</span>}
                <span className="rounded-full bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700">
                  {op}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {analysis.slowestOperations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-gray-500">Slowest Operations</p>
          <div className="space-y-1.5">
            {analysis.slowestOperations.map((op, idx) => {
              const widthPct = (op.durationMs / maxSlowDuration) * 100;
              return (
                <div key={idx}>
                  <div className="mb-0.5 flex items-center justify-between text-xs">
                    <span className="font-mono text-gray-700">{op.operationName}</span>
                    <span className="text-gray-500">{op.durationMs}ms</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100">
                    <div
                      className="h-1.5 rounded-full bg-blue-400"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
