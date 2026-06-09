'use client';

import { useEffect, useState } from 'react';

type Recommendation = {
  currentConcurrency: number;
  recommendedConcurrency: number;
  currentBatchSize: number;
  recommendedBatchSize: number;
  reasoning: string;
  confidenceScore: number;
};

type Props = {
  connectorId: string;
};

/**
 * Interactive wizard that shows current tuning settings,
 * fetches a recommendation, and lets the user apply it.
 */
export function ConcurrencyTuningWizard({ connectorId }: Props) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/sync-optimizer/config/${connectorId}`)
      .then((r) => r.json())
      .then((body) => setRec(body.data?.recommendation ?? null))
      .catch(() => setError('Failed to load tuning data'))
      .finally(() => setLoading(false));
  }, [connectorId]);

  const handleApply = async () => {
    if (!rec) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/v1/sync-optimizer/tuning/${connectorId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoApply: true }),
      });
      if (!res.ok) throw new Error('Apply failed');
      setApplied(true);
    } catch {
      setError('Failed to apply tuning');
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="mb-2 h-5 w-48 rounded bg-gray-100" />
        <div className="h-24 rounded bg-gray-100" />
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

  if (!rec) return null;

  const concurrencyDelta = rec.recommendedConcurrency - rec.currentConcurrency;
  const batchDelta = rec.recommendedBatchSize - rec.currentBatchSize;
  const confidencePct = Math.round(rec.confidenceScore * 100);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Concurrency Tuning — {connectorId}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            confidencePct >= 70
              ? 'bg-green-100 text-green-700'
              : confidencePct >= 40
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-gray-100 text-gray-600'
          }`}
        >
          {confidencePct}% confidence
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <TuneCard
          label="Concurrency"
          current={rec.currentConcurrency}
          recommended={rec.recommendedConcurrency}
          delta={concurrencyDelta}
          unit="workers"
        />
        <TuneCard
          label="Batch Size"
          current={rec.currentBatchSize}
          recommended={rec.recommendedBatchSize}
          delta={batchDelta}
          unit="entities"
        />
      </div>

      <p className="mb-4 text-xs text-gray-500">{rec.reasoning}</p>

      {applied ? (
        <p className="text-sm font-medium text-green-600">Settings applied successfully.</p>
      ) : (
        <button
          onClick={handleApply}
          disabled={applying}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply Recommendation'}
        </button>
      )}
    </div>
  );
}

function TuneCard({
  label,
  current,
  recommended,
  delta,
  unit,
}: {
  label: string;
  current: number;
  recommended: number;
  delta: number;
  unit: string;
}) {
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '=';
  const color =
    delta > 0 ? 'text-green-600' : delta < 0 ? 'text-amber-600' : 'text-gray-400';

  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 p-3">
      <p className="mb-1 text-xs text-gray-500">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold text-gray-900">{recommended}</span>
        <span className="text-xs text-gray-400">{unit}</span>
      </div>
      <p className={`mt-0.5 text-xs ${color}`}>
        {arrow} {Math.abs(delta)} from {current}
      </p>
    </div>
  );
}
