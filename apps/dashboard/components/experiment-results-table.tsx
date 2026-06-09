'use client';

import { useEffect, useState } from 'react';

type ExperimentEntry = {
  experiment: {
    id: string;
    variantName: string;
    concurrency: number;
    batchSize: number;
    trafficPct: number;
    status: string;
    startedAt: string | null;
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

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  aborted: 'bg-red-100 text-red-600',
};

/**
 * Table of A/B experiment results for a connector.
 */
export function ExperimentResultsTable({ connectorId, limit = 20 }: Props) {
  const [entries, setEntries] = useState<ExperimentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/sync-optimizer/experiments?connectorId=${encodeURIComponent(connectorId)}&limit=${limit}`)
      .then((r) => r.json())
      .then((body) => setEntries(body.data ?? []))
      .catch(() => setError('Failed to load experiment results'))
      .finally(() => setLoading(false));
  }, [connectorId, limit]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-gray-100" />
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

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Experiment Results — {connectorId}
        </h3>
      </div>

      {entries.length === 0 ? (
        <p className="p-4 text-sm text-gray-400">No experiments found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Variant</th>
                <th className="px-4 py-2 text-right font-medium">Concurrency</th>
                <th className="px-4 py-2 text-right font-medium">Batch</th>
                <th className="px-4 py-2 text-right font-medium">Throughput/s</th>
                <th className="px-4 py-2 text-right font-medium">p95 ms</th>
                <th className="px-4 py-2 text-right font-medium">Error %</th>
                <th className="px-4 py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const exp = entry.experiment;
                const res = entry.result;
                const badgeClass = STATUS_BADGE[exp.status] ?? 'bg-gray-100 text-gray-600';
                return (
                  <tr
                    key={exp.id}
                    className="border-b border-gray-50 hover:bg-gray-50"
                  >
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">
                      {exp.variantName}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">{exp.concurrency}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{exp.batchSize}</td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {res ? res.throughputPerSec.toFixed(1) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {res ? res.p95LatencyMs.toFixed(0) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-700">
                      {res
                        ? (
                            <span
                              className={res.errorRate > 0.05 ? 'font-semibold text-red-600' : ''}
                            >
                              {(res.errorRate * 100).toFixed(1)}%
                            </span>
                          )
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                        {exp.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
