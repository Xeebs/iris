'use client';

type QuerySummary = {
  totalQueries: number;
  cacheHitRate: number;
  avgLatencyMs: number;
};

type QueryEvent = {
  queryId: string;
  cacheHit: boolean;
  latencyMs: number;
  tokensSpent: number;
  timestamp: string;
  entityTypes: string[];
};

type Props = {
  summary: QuerySummary;
  recentEvents: QueryEvent[];
};

/**
 * Shows cache hit rate over time and the latency delta between cache hits and misses.
 */
export function CachePerformanceDashboard({ summary, recentEvents }: Props) {
  const hits = recentEvents.filter((e) => e.cacheHit);
  const misses = recentEvents.filter((e) => !e.cacheHit);

  const avgHitLatency = hits.length > 0
    ? Math.round(hits.reduce((a, e) => a + e.latencyMs, 0) / hits.length)
    : 0;

  const avgMissLatency = misses.length > 0
    ? Math.round(misses.reduce((a, e) => a + e.latencyMs, 0) / misses.length)
    : 0;

  const tokensSavedEstimate = hits.reduce((a, e) => a + e.tokensSpent, 0);

  const hitsByHour = new Array<number>(24).fill(0);
  const missesByHour = new Array<number>(24).fill(0);
  for (const e of recentEvents) {
    const hour = new Date(e.timestamp).getHours();
    if (e.cacheHit) hitsByHour[hour]!++;
    else missesByHour[hour]!++;
  }

  const maxBar = Math.max(...hitsByHour, ...missesByHour, 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Cache Hit Rate" value={`${(summary.cacheHitRate * 100).toFixed(1)}%`} sub="last 7 days" />
        <MetricCard
          label="Latency Improvement"
          value={avgMissLatency > 0 ? `${((1 - avgHitLatency / avgMissLatency) * 100).toFixed(0)}%` : '—'}
          sub={`${avgHitLatency}ms hits vs ${avgMissLatency}ms misses`}
        />
        <MetricCard
          label="Tokens Saved (est.)"
          value={tokensSavedEstimate.toLocaleString()}
          sub="from cache hits"
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Cache Hits vs Misses by Hour</h3>
        <div className="flex items-end gap-1 h-24">
          {hitsByHour.map((h, i) => {
            const m = missesByHour[i]!;
            return (
              <div key={i} className="flex-1 flex flex-col-reverse gap-0.5" title={`${i}:00 — ${h} hits, ${m} misses`}>
                <div className="bg-indigo-400 rounded-t-sm" style={{ height: `${(h / maxBar) * 80}px` }} />
                <div className="bg-gray-200 rounded-t-sm" style={{ height: `${(m / maxBar) * 80}px` }} />
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-2">
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 bg-indigo-400 rounded-sm" /> Cache hit
          </span>
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 bg-gray-200 rounded-sm" /> Cache miss
          </span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className="text-xl font-bold text-gray-900">{value}</div>
      <div className="text-xs font-medium text-gray-700 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
