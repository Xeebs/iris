'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  AnalyticsFilterControls,
  type Granularity,
  type GroupBy,
} from '../../../../components/analytics-filter-controls.js';
import {
  TokenBreakdownChart,
  type BreakdownBucket,
} from '../../../../components/token-breakdown-chart.js';

interface BreakdownSummary {
  buckets: BreakdownBucket[];
  groupNames: string[];
  granularity: string;
  groupBy: string;
}

const API_URL = typeof process !== 'undefined'
  ? (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1')
  : '/api/v1';

export default function AnalyticsBreakdownPage({
  params,
}: {
  params: { workspaceId: string };
}): React.JSX.Element {
  const { workspaceId } = params;

  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [groupBy, setGroupBy] = useState<GroupBy>('connector');
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<BreakdownSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        workspaceId,
        granularity,
        groupBy,
        days: String(days),
      });
      const res = await fetch(`${API_URL}/analytics/breakdown?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: BreakdownSummary };
      setSummary(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load breakdown');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, granularity, groupBy, days]);

  useEffect(() => { void load(); }, [load]);

  const totalSpent = summary?.buckets.reduce(
    (s, b) => s + Object.values(b.groups).reduce((gs, g) => gs + g.tokensSpent, 0),
    0,
  ) ?? 0;

  const totalSaved = summary?.buckets.reduce(
    (s, b) => s + Object.values(b.groups).reduce((gs, g) => gs + g.tokensSaved, 0),
    0,
  ) ?? 0;

  const totalQueries = summary?.buckets.reduce(
    (s, b) => s + Object.values(b.groups).reduce((gs, g) => gs + g.queryCount, 0),
    0,
  ) ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Link href="/" className="hover:text-gray-700">Dashboard</Link>
          <span>/</span>
          <Link href="/analytics" className="hover:text-gray-700">Analytics</Link>
          <span>/</span>
          <span className="text-gray-700">Breakdown</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Token Usage Breakdown</h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{workspaceId}</p>
      </header>

      <div className="mb-6 p-4 rounded-lg bg-white border">
        <AnalyticsFilterControls
          granularity={granularity}
          groupBy={groupBy}
          days={days}
          onGranularityChange={setGranularity}
          onGroupByChange={setGroupBy}
          onDaysChange={setDays}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tokens Spent</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{totalSpent.toLocaleString()}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Tokens Saved</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-green-600">{totalSaved.toLocaleString()}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Queries</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{totalQueries.toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Token spend by {groupBy} — {granularity}
        </h2>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded mb-4">{error}</div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading breakdown…</div>
        ) : (
          <TokenBreakdownChart
            buckets={summary?.buckets ?? []}
            groupNames={summary?.groupNames ?? []}
          />
        )}
      </div>

      {summary && summary.groupNames.length > 0 && (
        <div className="mt-6 bg-white border rounded-lg p-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Per-group totals</h2>
          <div className="divide-y divide-gray-100">
            {summary.groupNames.map((name) => {
              const spent = summary.buckets.reduce(
                (s, b) => s + (b.groups[name]?.tokensSpent ?? 0), 0,
              );
              const saved = summary.buckets.reduce(
                (s, b) => s + (b.groups[name]?.tokensSaved ?? 0), 0,
              );
              const queries = summary.buckets.reduce(
                (s, b) => s + (b.groups[name]?.queryCount ?? 0), 0,
              );
              const pct = totalSpent > 0 ? ((spent / totalSpent) * 100).toFixed(1) : '0.0';
              return (
                <div key={name} className="py-3 flex items-center gap-4">
                  <div className="flex-1 font-medium text-sm text-gray-700">{name}</div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums text-gray-800">{spent.toLocaleString()} tokens</p>
                    <p className="text-xs text-gray-400">{pct}% of total</p>
                  </div>
                  <div className="text-right w-24">
                    <p className="text-xs text-green-600 tabular-nums">+{saved.toLocaleString()} saved</p>
                    <p className="text-xs text-gray-400">{queries} queries</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
