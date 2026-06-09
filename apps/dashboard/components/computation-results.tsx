'use client';

import React from 'react';

export type ComputedMetric = {
  metricId: string;
  name: string;
  formulaText: string;
  description: string | null;
  lastComputedValue: number | null;
  lastComputedAt: string | null;
  status: 'success' | 'error' | 'pending';
  error: string | null;
};

type RecentComputation = {
  logId: string;
  value: number | null;
  entityCount: number;
  executionMs: number;
  error: string | null;
  computedAt: string;
};

type Props = {
  metric: ComputedMetric;
  recentComputations?: RecentComputation[];
};

function StatusBadge({ status }: { status: ComputedMetric['status'] }) {
  const styles = {
    success: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
    pending: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export function ComputationResults({ metric, recentComputations = [] }: Props) {
  const formatValue = (v: number | null): string => {
    if (v === null) return '—';
    if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(2);
  };

  const lastUpdated = metric.lastComputedAt
    ? new Date(metric.lastComputedAt).toLocaleString()
    : 'Never';

  return (
    <div className="space-y-4">
      <div className="p-6 border rounded-xl bg-white shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">{metric.name}</h3>
            {metric.description && (
              <p className="text-sm text-gray-500 mt-0.5">{metric.description}</p>
            )}
          </div>
          <StatusBadge status={metric.status} />
        </div>

        <div className="mt-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Current Value</p>
          <p className="text-4xl font-bold text-gray-900 mt-1">
            {formatValue(metric.lastComputedValue)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Last computed: {lastUpdated}</p>
        </div>

        {metric.status === 'error' && metric.error && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {metric.error}
          </div>
        )}

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1">Formula</p>
          <code className="text-sm text-blue-700 bg-blue-50 px-2 py-1 rounded font-mono block">
            {metric.formulaText}
          </code>
        </div>
      </div>

      {recentComputations.length > 0 && (
        <div className="border rounded-xl overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b">
            <h4 className="text-sm font-medium text-gray-700">Computation History</h4>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Computed at</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Value</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Entities</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500">Time (ms)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentComputations.map((c) => (
                <tr key={c.logId} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-600">
                    {new Date(c.computedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-medium text-gray-900">
                    {c.error ? (
                      <span className="text-red-500">Error</span>
                    ) : (
                      formatValue(c.value)
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {c.entityCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {c.executionMs.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
