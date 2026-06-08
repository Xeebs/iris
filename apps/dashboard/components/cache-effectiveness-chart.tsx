'use client';

type CacheStats = {
  accuracyRatio: number;
  totalPredictions: number;
  cacheHitsFromWarming: number;
  avgLatencyImprovementMs: number;
};

type Props = {
  stats: CacheStats;
  isLoading?: boolean;
};

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white border rounded-lg p-4 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function AccuracyBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600 mb-1">
        <span>Prewarming Accuracy</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CacheEffectivenessChart({ stats, isLoading }: Props) {
  if (isLoading) {
    return <div className="animate-pulse bg-gray-100 rounded-lg h-32" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Predictions Made"
          value={stats.totalPredictions.toLocaleString()}
          color="text-gray-900"
        />
        <StatCard
          label="Cache Hits from Warming"
          value={stats.cacheHitsFromWarming.toLocaleString()}
          color="text-green-600"
        />
        <StatCard
          label="Accuracy"
          value={`${Math.round(stats.accuracyRatio * 100)}%`}
          color={stats.accuracyRatio >= 0.7 ? 'text-green-600' : 'text-amber-600'}
        />
        <StatCard
          label="Avg Latency Saved"
          value={`${stats.avgLatencyImprovementMs}ms`}
          color="text-blue-600"
        />
      </div>

      <AccuracyBar ratio={stats.accuracyRatio} />

      {stats.accuracyRatio >= 0.25 && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          Cache prewarming is active — estimated {stats.avgLatencyImprovementMs}ms average latency reduction on prewarmed queries.
        </div>
      )}

      {stats.accuracyRatio < 0.25 && stats.totalPredictions > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
          Prewarming accuracy is low. The engine needs more query history to improve predictions.
        </div>
      )}
    </div>
  );
}
