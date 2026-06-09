'use client';

import { useState } from 'react';

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';
const BASE = '/api/v1';

type WarmResult = {
  warmed: number;
  skipped: number;
  candidates: { queryHash: string; accessCount: number }[];
};

type MissPattern = { reason: string; count: number };

const REASON_DESCRIPTIONS: Record<string, string> = {
  no_entry: 'No cache entry exists for this query/date combination.',
  expired: 'A cache entry existed but its TTL expired.',
  date_mismatch: 'Cached entry exists but not for the requested as-of date.',
  decode_error: 'Cache entry could not be decoded (data corruption).',
};

type Props = {
  patterns: MissPattern[];
  totalMisses: number;
};

export function MissPatternAnalyzer({ patterns, totalMisses }: Props) {
  const [warming, setWarming] = useState(false);
  const [warmResult, setWarmResult] = useState<WarmResult | null>(null);
  const [intervalDays, setIntervalDays] = useState(3);

  async function triggerPreload() {
    setWarming(true);
    setWarmResult(null);
    try {
      const res = await fetch(`${BASE}/cache/preload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({ intervalDays }),
      });
      if (res.ok) {
        const body = await res.json() as { data: WarmResult };
        setWarmResult(body.data);
      }
    } finally {
      setWarming(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
      <h2 className="text-base font-semibold text-white mb-4">Miss Pattern Analyzer</h2>

      {patterns.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm">No miss patterns recorded.</div>
      ) : (
        <div className="space-y-3 mb-5">
          {patterns.map((p) => {
            const pct = totalMisses === 0 ? 0 : Math.round((p.count / totalMisses) * 100);
            const description = REASON_DESCRIPTIONS[p.reason] ?? 'Unknown miss reason.';
            return (
              <div key={p.reason} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-200 capitalize">
                    {p.reason.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-bold text-red-400">{pct}%</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">{description}</p>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-red-600 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-xs text-gray-500 mt-1">{p.count.toLocaleString()} misses</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Proactive warm action */}
      <div className="border-t border-gray-800 pt-4">
        <div className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Proactive Cache Warming</div>
        <p className="text-xs text-gray-500 mb-3">
          Pre-caches high-access queries from the last N days to reduce future misses.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-gray-400">Look-back:</label>
          {[1, 3, 7].map((d) => (
            <button
              key={d}
              onClick={() => setIntervalDays(d)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                intervalDays === d ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
        <button
          onClick={() => void triggerPreload()}
          disabled={warming}
          className="w-full py-2 bg-indigo-700 hover:bg-indigo-600 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded-lg transition-colors"
        >
          {warming ? 'Warming...' : 'Warm Cache Now'}
        </button>

        {warmResult && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="bg-gray-800 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-green-400">{warmResult.warmed}</div>
              <div className="text-xs text-gray-500">Warmed</div>
            </div>
            <div className="bg-gray-800 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-gray-400">{warmResult.skipped}</div>
              <div className="text-xs text-gray-500">Already Cached</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
