'use client';

import { useEffect, useState } from 'react';
import { MetricOverviewCards } from '../../../../components/metric-overview-cards';

type MetricCard = { label: string; value: string | number; sublabel?: string; trend?: 'up' | 'down' | 'stable' };
type AnomalyEntry = { metricName: string; timestamp: string; value: number; expectedValue: number; zScore: number; isAnomaly: boolean };
type DashboardData = { avgTokenSavedPct?: number; totalQueries?: number; avgErrorRate?: number; template: string };

export default function AnalyticsOverviewPage({ params }: { params: { workspaceId: string } }) {
  const { workspaceId } = params;
  const [cards, setCards] = useState<MetricCard[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyEntry[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState<'1h' | '1d' | '1w'>('1d');

  useEffect(() => {
    setLoading(true);
    const headers = { 'X-Workspace-Id': workspaceId };

    Promise.all([
      fetch(`/api/v1/analytics/metrics/query_latency?window=${window}`, { headers }).then((r) => r.json()),
      fetch(`/api/v1/analytics/metrics/tokens_saved?window=${window}`, { headers }).then((r) => r.json()),
      fetch(`/api/v1/analytics/metrics/connector_error?window=${window}`, { headers }).then((r) => r.json()),
      fetch(`/api/v1/analytics/metrics/query_latency/anomalies?hours=24`, { headers }).then((r) => r.json()),
      fetch(`/api/v1/analytics/dashboards/token-efficiency?window=${window}`, { headers }).then((r) => r.json()),
    ]).then(([latencyRes, tokenRes, errorRes, anomalyRes, dashRes]) => {
      const latency = latencyRes.data ?? {};
      const tokens = tokenRes.data ?? {};
      const errors = errorRes.data ?? {};

      setCards([
        { label: 'Avg Query Latency', value: `${(latency.mean ?? 0).toFixed(0)}ms`, sublabel: `p95: ${(latency.p95 ?? 0).toFixed(0)}ms`, trend: latency.mean > 200 ? 'down' : 'up' },
        { label: 'Total Queries', value: (latency.count ?? 0).toLocaleString(), sublabel: `in selected window` },
        { label: 'Avg Tokens Saved', value: `${(tokens.mean ?? 0).toFixed(0)}`, sublabel: `tokens/query` },
        { label: 'Connector Errors', value: (errors.count ?? 0).toLocaleString(), trend: errors.count > 0 ? 'down' : 'stable' },
      ]);
      setAnomalies(anomalyRes.data ?? []);
      setDashboard(dashRes.data ?? null);
    }).finally(() => setLoading(false));
  }, [workspaceId, window]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics Overview</h1>
          <p className="text-sm text-zinc-400 mt-1">Workspace: <span className="font-mono text-zinc-300">{workspaceId}</span></p>
        </div>
        <div className="flex gap-1 rounded-lg bg-zinc-800 p-1">
          {(['1h', '1d', '1w'] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${window === w ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <MetricOverviewCards cards={cards} loading={loading} />

      <div className="grid grid-cols-2 gap-6">
        {/* Anomalies */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-300">Anomaly Timeline (last 24h)</h3>
            <span className="text-xs text-zinc-500">{anomalies.length} detected</span>
          </div>
          <div className="divide-y divide-zinc-800">
            {anomalies.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-mono text-zinc-300">{a.metricName}</div>
                  <div className="text-xs text-zinc-500">value: {a.value.toFixed(2)} · z={a.zScore.toFixed(2)}</div>
                </div>
                <span className="text-xs text-zinc-600">{new Date(a.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
            {anomalies.length === 0 && !loading && (
              <div className="px-4 py-6 text-center text-sm text-zinc-500">No anomalies detected.</div>
            )}
          </div>
        </div>

        {/* Token efficiency summary */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">Token Efficiency</h3>
          {dashboard ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-zinc-400">Average tokens saved per query</p>
                <p className="text-3xl font-bold text-white">{((dashboard.avgTokenSavedPct ?? 0)).toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-zinc-400">Total queries analyzed</p>
                <p className="text-xl font-semibold text-zinc-300">{(dashboard.totalQueries ?? 0).toLocaleString()}</p>
              </div>
              {dashboard.avgErrorRate !== undefined && (
                <div>
                  <p className="text-xs text-zinc-400">Connector error rate</p>
                  <p className={`text-xl font-semibold ${(dashboard.avgErrorRate ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {((dashboard.avgErrorRate ?? 0) * 100).toFixed(2)}%
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">{loading ? 'Loading…' : 'No dashboard data.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
