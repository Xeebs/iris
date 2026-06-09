'use client';

import { useState, useEffect } from 'react';

type MissPattern = { reason: string; count: number };
type MissedQuery = { queryHash: string; missCount: number; lastMissedAt: string };

type Analytics = {
  intervalDays: number;
  totalRequests: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  topMissedQueries: MissedQuery[];
  missPatterns: MissPattern[];
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';
const BASE = '/api/v1';

function HitBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-400 w-24 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
}

export function CacheHitTimeline() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setInterval_] = useState(7);

  useEffect(() => { void load(); }, [interval]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/cache/analytics?intervalDays=${interval}`, {
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      if (res.ok) {
        const body = await res.json() as { data: Analytics };
        setData(body.data);
      }
    } finally {
      setLoading(false);
    }
  }

  const hitRate = data ? Math.round(data.hitRate * 100) : 0;
  const hitRateColor = hitRate >= 70 ? 'text-green-400' : hitRate >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-white">Cache Hit Timeline</h2>
        <div className="flex items-center gap-2">
          {[3, 7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setInterval_(d)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                interval === d ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      ) : !data ? (
        <div className="text-center py-8 text-gray-500 text-sm">No data available.</div>
      ) : (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className={`text-2xl font-bold ${hitRateColor}`}>{hitRate}%</div>
              <div className="text-xs text-gray-500 mt-0.5">Hit Rate</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{data.hitCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Hits</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{data.missCount.toLocaleString()}</div>
              <div className="text-xs text-gray-500 mt-0.5">Misses</div>
            </div>
          </div>

          {/* Miss patterns */}
          {data.missPatterns.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Miss Patterns</div>
              <div className="space-y-2">
                {data.missPatterns.map((p) => (
                  <HitBar
                    key={p.reason}
                    label={p.reason.replace(/_/g, ' ')}
                    value={p.count}
                    max={data.missCount}
                    color="bg-red-600"
                  />
                ))}
              </div>
            </div>
          )}

          {/* Top missed queries */}
          {data.topMissedQueries.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Top Missed Queries</div>
              <div className="space-y-1">
                {data.topMissedQueries.slice(0, 5).map((q) => (
                  <div key={q.queryHash} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-gray-400">{q.queryHash}</span>
                    <div className="flex items-center gap-3 text-gray-500">
                      <span>{q.missCount} misses</span>
                      <span>{new Date(q.lastMissedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
