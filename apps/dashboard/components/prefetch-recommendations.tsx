'use client';

import React from 'react';

export type PrefetchRec = {
  queryHash: string;
  queryText: string;
  confidence: number;
  reason: string;
};

type Props = {
  recommendations: PrefetchRec[];
  onPrefetch?: (queryHash: string) => void;
  isLoading?: boolean;
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-400' : 'bg-orange-400';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 w-10 text-right">{pct}%</span>
    </div>
  );
}

export function PrefetchRecommendations({ recommendations, onPrefetch, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg" />
        ))}
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No prefetch recommendations — not enough query history.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Prefetch Recommendations</h3>
        <span className="text-xs text-gray-400">{recommendations.length} queries</span>
      </div>

      <div className="space-y-2">
        {recommendations.map((rec) => (
          <div
            key={rec.queryHash}
            className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg hover:border-blue-200 transition-colors"
          >
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-sm font-medium text-gray-800 truncate">{rec.queryText}</p>
              <p className="text-xs text-gray-500">{rec.reason}</p>
              <ConfidenceBar value={rec.confidence} />
            </div>

            {onPrefetch && (
              <button
                type="button"
                onClick={() => onPrefetch(rec.queryHash)}
                className="shrink-0 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
              >
                Prefetch
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Confidence = frequency in recent user history. Queries already cached are excluded.
      </p>
    </div>
  );
}
