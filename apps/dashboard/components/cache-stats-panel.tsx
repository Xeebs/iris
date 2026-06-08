'use client';

import { useState, useEffect, useCallback } from 'react';

type ToolStats = {
  hits: number;
  misses: number;
};

type CacheStats = {
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  toolStats: Record<string, ToolStats>;
  approxKeyCount: number;
};

type CacheStatsPanelProps = {
  refreshIntervalMs?: number;
};

function HitRateBar({ rate }: { rate: number }): React.JSX.Element {
  const pct = Math.round(rate * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400';
  return (
    <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function CacheStatsPanel({ refreshIntervalMs = 30_000 }: CacheStatsPanelProps): React.JSX.Element {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/cache/stats');
      if (res.ok) {
        const body = await res.json() as { data: CacheStats };
        setStats(body.data);
        setLastRefreshed(new Date());
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    const id = setInterval(() => void loadStats(), refreshIntervalMs);
    return () => clearInterval(id);
  }, [loadStats, refreshIntervalMs]);

  async function handleReset(): Promise<void> {
    setResetting(true);
    try {
      await fetch('/api/v1/cache/stats', { method: 'DELETE' });
      await loadStats();
    } finally {
      setResetting(false);
    }
  }

  const totalRequests = (stats?.totalHits ?? 0) + (stats?.totalMisses ?? 0);

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Response Cache</h3>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-gray-400">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={() => void loadStats()}
            className="rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={resetting}
            onClick={() => void handleReset()}
            className="rounded-lg px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : stats ? (
        <>
          {/* Summary row */}
          <div className="mt-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold tabular-nums text-gray-900">
                {Math.round(stats.hitRate * 100)}%
              </p>
              <p className="text-xs text-gray-500">Hit Rate</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-green-600">{stats.totalHits.toLocaleString()}</p>
              <p className="text-xs text-gray-500">Hits</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-gray-500">{stats.totalMisses.toLocaleString()}</p>
              <p className="text-xs text-gray-500">Misses</p>
            </div>
          </div>

          <div className="mt-3">
            <HitRateBar rate={stats.hitRate} />
            <p className="mt-1 text-right text-xs text-gray-400">
              {totalRequests.toLocaleString()} total requests · {stats.approxKeyCount.toLocaleString()} keys in Redis
            </p>
          </div>

          {/* Per-tool breakdown */}
          {Object.keys(stats.toolStats).length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Per Tool</p>
              <div className="space-y-2">
                {Object.entries(stats.toolStats).map(([tool, ts]) => {
                  const toolTotal = ts.hits + ts.misses;
                  const toolHitRate = toolTotal > 0 ? ts.hits / toolTotal : 0;
                  return (
                    <div key={tool} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate font-mono text-xs text-gray-700">{tool}</span>
                      <div className="flex-1">
                        <HitRateBar rate={toolHitRate} />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-gray-500">
                        {Math.round(toolHitRate * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-400">Unable to load cache statistics.</p>
      )}
    </div>
  );
}
