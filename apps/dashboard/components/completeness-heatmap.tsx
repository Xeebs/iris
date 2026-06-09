'use client';

import { useEffect, useState } from 'react';

type QualityMetric = {
  entityType: string;
  meanCompleteness: number;
  sourceDiversityEntropy: number;
  entityCount: number;
};

type Props = {
  connectorId: string;
  entityTypes?: string[];
};

function completenessColor(pct: number): string {
  if (pct >= 90) return 'bg-green-100 text-green-800';
  if (pct >= 70) return 'bg-yellow-100 text-yellow-800';
  if (pct >= 50) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

/**
 * Heatmap of enrichment completeness per entity type for a connector.
 */
export function CompletenessHeatmap({ connectorId, entityTypes = [] }: Props) {
  const [metrics, setMetrics] = useState<QualityMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/enrichment/quality/${connectorId}`)
      .then((r) => r.json())
      .then((body) => setMetrics(body.data ?? []))
      .catch(() => setError('Failed to load completeness data'))
      .finally(() => setLoading(false));
  }, [connectorId]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded bg-gray-100" />
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

  const displayTypes =
    entityTypes.length > 0
      ? entityTypes
      : [...new Set(metrics.map((m) => m.entityType))];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Completeness by Entity Type</h3>
        <div className="flex gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-green-200" /> ≥90%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-orange-200" /> &lt;50%
          </span>
        </div>
      </div>

      {displayTypes.length === 0 ? (
        <p className="text-sm text-gray-400">No completeness data available.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {displayTypes.map((type) => {
            const metric = metrics.find((m) => m.entityType === type);
            const pct = metric ? Math.round(metric.meanCompleteness) : null;
            return (
              <div
                key={type}
                className={`rounded-lg p-3 text-center ${
                  pct !== null ? completenessColor(pct) : 'bg-gray-50 text-gray-400'
                }`}
              >
                <p className="text-xs font-medium capitalize">{type}</p>
                <p className="mt-1 text-2xl font-bold">
                  {pct !== null ? `${pct}%` : '—'}
                </p>
                {metric && (
                  <p className="mt-0.5 text-[10px] opacity-70">
                    {metric.entityCount} entities
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
