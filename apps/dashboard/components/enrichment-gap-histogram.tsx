'use client';

import { useEffect, useState } from 'react';

type Gap = {
  fieldName: string;
  nullRate: number;
  nullCount: number;
  totalCount: number;
};

type Props = {
  connectorId: string;
  entityType: string;
  minNullRate?: number;
};

/**
 * Histogram of systematically unenriched fields ordered by null rate.
 */
export function EnrichmentGapHistogram({ connectorId, entityType, minNullRate = 0.3 }: Props) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({
      connectorId,
      entityType,
      minNullRate: String(minNullRate),
    });

    fetch(`/api/v1/enrichment/gaps?${params}`)
      .then((r) => r.json())
      .then((body) => setGaps(body.data ?? []))
      .catch(() => setError('Failed to load gap data'))
      .finally(() => setLoading(false));
  }, [connectorId, entityType, minNullRate]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 rounded bg-gray-100" />
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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Enrichment Gaps — {entityType} ({connectorId})
        </h3>
        <span className="text-xs text-gray-400">&gt;{Math.round(minNullRate * 100)}% null</span>
      </div>

      {gaps.length === 0 ? (
        <p className="text-sm text-gray-400">
          No significant gaps detected above {Math.round(minNullRate * 100)}% null rate.
        </p>
      ) : (
        <div className="space-y-2.5">
          {gaps.slice(0, 15).map((gap) => {
            const pct = Math.round(gap.nullRate * 100);
            const barColor = pct > 80 ? 'bg-red-400' : pct > 60 ? 'bg-amber-400' : 'bg-yellow-300';
            return (
              <div key={gap.fieldName}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-mono text-gray-700">{gap.fieldName}</span>
                  <span
                    className={`font-semibold ${
                      pct > 80 ? 'text-red-600' : pct > 60 ? 'text-amber-600' : 'text-yellow-700'
                    }`}
                  >
                    {pct}% null ({gap.nullCount}/{gap.totalCount})
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {gaps.length > 15 && (
            <p className="text-xs text-gray-400">+{gaps.length - 15} more gaps</p>
          )}
        </div>
      )}
    </div>
  );
}
