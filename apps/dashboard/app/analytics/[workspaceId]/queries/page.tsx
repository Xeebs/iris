'use client';

import { useState, useEffect, useCallback } from 'react';
import { QueryHeatmapChart } from '../../../../components/query-heatmap-chart.js';
import { CachePerformanceDashboard } from '../../../../components/cache-performance-dashboard.js';
import { QueryPatternExplorer } from '../../../../components/query-pattern-explorer.js';

type QuerySummary = {
  totalQueries: number;
  cacheHitRate: number;
  avgLatencyMs: number;
};

type QueryPattern = {
  patternType: 'temporal' | 'user' | 'entity_type';
  definition: Record<string, unknown>;
  confidenceScore: number;
  discoveredAt: string;
};

type TopSignature = {
  signature: string;
  count: number;
  lastSeen: string;
};

type AnalyticsData = {
  summary: QuerySummary;
  topSignatures: TopSignature[];
  patterns: QueryPattern[];
  recentEvents: Array<{
    queryId: string;
    queryText: string;
    querySignature: string;
    cacheHit: boolean;
    latencyMs: number;
    tokensSpent: number;
    timestamp: string;
    entityTypes: string[];
  }>;
};

type Props = {
  params: { workspaceId: string };
};

const TABS = ['overview', 'heatmap', 'cache', 'patterns'] as const;
type Tab = (typeof TABS)[number];

export default function QueryAnalyticsPage({ params }: Props) {
  const { workspaceId } = params;
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [detecting, setDetecting] = useState(false);
  const [warming, setWarming] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/analytics/queries?limitHours=168', {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) {
        const { data: d } = await res.json() as { data: AnalyticsData };
        setData(d);
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to load analytics.' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function detectPatterns() {
    setDetecting(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v1/analytics/queries/detect-patterns', {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) {
        const { data: d } = await res.json() as { data: { patternsDetected: number } };
        setMsg({ type: 'ok', text: `${d.patternsDetected} pattern(s) detected.` });
        void load();
      } else {
        setMsg({ type: 'err', text: 'Pattern detection failed.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Network error.' });
    } finally {
      setDetecting(false);
    }
  }

  async function triggerWarming() {
    setWarming(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v1/analytics/cache-warming/trigger', {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) {
        const { data: d } = await res.json() as { data: { signaturesWarmed: number } };
        setMsg({ type: 'ok', text: `Cache warming complete — ${d.signaturesWarmed} signature(s) warmed.` });
      } else {
        setMsg({ type: 'err', text: 'Cache warming failed.' });
      }
    } catch {
      setMsg({ type: 'err', text: 'Network error.' });
    } finally {
      setWarming(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Query Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track query patterns, cache performance, and proactive warming for workspace{' '}
            <span className="font-mono text-xs">{workspaceId}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void detectPatterns()}
            disabled={detecting}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            {detecting ? 'Detecting…' : 'Detect Patterns'}
          </button>
          <button
            onClick={() => void triggerWarming()}
            disabled={warming}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {warming ? 'Warming…' : 'Warm Cache'}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-md p-3 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Total Queries (7d)" value={data.summary.totalQueries.toLocaleString()} />
          <StatCard
            label="Cache Hit Rate"
            value={`${(data.summary.cacheHitRate * 100).toFixed(1)}%`}
            highlight={data.summary.cacheHitRate > 0.5}
          />
          <StatCard label="Avg Latency" value={`${data.summary.avgLatencyMs}ms`} />
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400 animate-pulse py-8 text-center">Loading analytics…</div>
      ) : data ? (
        <div>
          {tab === 'overview' && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-gray-900">Top Query Signatures</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-gray-500 uppercase tracking-wide">
                      <th className="text-left py-2 pr-4">Signature</th>
                      <th className="text-left py-2 pr-4">Frequency</th>
                      <th className="text-left py-2">Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topSignatures.map((s) => (
                      <tr key={s.signature} className="border-b border-gray-100">
                        <td className="py-2 pr-4 font-mono text-xs text-gray-600">{s.signature}</td>
                        <td className="py-2 pr-4">{s.count}</td>
                        <td className="py-2 text-gray-400 text-xs">{new Date(s.lastSeen).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'heatmap' && (
            <QueryHeatmapChart events={data.recentEvents} />
          )}

          {tab === 'cache' && (
            <CachePerformanceDashboard
              summary={data.summary}
              recentEvents={data.recentEvents}
            />
          )}

          {tab === 'patterns' && (
            <QueryPatternExplorer patterns={data.patterns} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      <div className={`text-2xl font-bold ${highlight ? 'text-green-600' : 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
