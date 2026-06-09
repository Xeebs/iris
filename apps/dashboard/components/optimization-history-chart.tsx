'use client';

import { useEffect, useState } from 'react';

type ExperimentEntry = {
  experiment: {
    id: string;
    variantName: string;
    concurrency: number;
    batchSize: number;
    status: string;
    completedAt: string | null;
  };
  result: {
    throughputPerSec: number;
    p95LatencyMs: number;
    errorRate: number;
    entitiesSynced: number;
  } | null;
};

type Props = {
  connectorId: string;
  limit?: number;
};

/**
 * Bar chart showing throughput improvement over successive optimization experiments.
 */
export function OptimizationHistoryChart({ connectorId, limit = 10 }: Props) {
  const [entries, setEntries] = useState<ExperimentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/sync-optimizer/experiments?connectorId=${encodeURIComponent(connectorId)}&limit=${limit}`)
      .then((r) => r.json())
      .then((body) => setEntries(body.data ?? []))
      .catch(() => setError('Failed to load experiment history'))
      .finally(() => setLoading(false));
  }, [connectorId, limit]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="flex h-32 items-end gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-1 rounded-t bg-gray-100" style={{ height: `${20 + i * 12}%` }} />
          ))}
        </div>
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

  const completed = entries.filter((e) => e.result !== null);
  if (completed.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-400">No completed experiments yet.</p>
      </div>
    );
  }

  const maxThroughput = Math.max(...completed.map((e) => e.result!.throughputPerSec));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">
        Optimization History — {connectorId}
      </h3>

      <div className="flex h-36 items-end gap-2">
        {completed.slice(-10).map((entry, idx) => {
          const height = maxThroughput > 0
            ? Math.max(4, (entry.result!.throughputPerSec / maxThroughput) * 100)
            : 4;
          const errorPct = entry.result!.errorRate * 100;
          const barColor =
            errorPct > 5 ? 'bg-red-400' : errorPct > 1 ? 'bg-amber-400' : 'bg-blue-500';
          return (
            <div key={entry.experiment.id} className="group relative flex-1">
              <div
                className={`rounded-t ${barColor} transition-all`}
                style={{ height: `${height}%` }}
                title={`${entry.experiment.variantName}: ${entry.result!.throughputPerSec.toFixed(1)}/s`}
              />
              <div className="absolute bottom-full left-1/2 mb-1 hidden w-28 -translate-x-1/2 rounded bg-gray-800 p-1 text-center text-xs text-white group-hover:block">
                {entry.result!.throughputPerSec.toFixed(1)}/s
                <br />
                p95: {entry.result!.p95LatencyMs.toFixed(0)}ms
              </div>
              <p className="mt-1 truncate text-center text-xs text-gray-400">
                {idx + 1}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500" />Good</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-400" />Elevated errors</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-red-400" />High errors</span>
      </div>
    </div>
  );
}
