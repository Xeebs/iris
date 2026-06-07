'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  count: number;
}

interface OperationStats {
  operation: string;
  connectorId: string | null;
  percentiles: LatencyPercentiles;
}

interface ConnectorBreakdown {
  connectorId: string;
  p95Ms: number;
  sampleCount: number;
}

interface ProfilerDashboardProps {
  workspaceId: string;
}

const OPERATION_LABELS: Record<string, string> = {
  connector_sync: 'Connector Sync',
  semantic_indexing: 'Semantic Indexing',
  vector_search: 'Vector Search',
  cache_read: 'Cache Read',
  cache_write: 'Cache Write',
  embedding_generate: 'Embedding Generate',
  mcp_tool_call: 'MCP Tool Call',
  graph_query: 'Graph Query',
};

function latencyBadgeClass(ms: number): string {
  if (ms < 100) return 'bg-green-100 text-green-800';
  if (ms < 500) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

function LatencyBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full rounded bg-gray-100">
      <div className="h-1.5 rounded bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ProfilerDashboard({ workspaceId }: ProfilerDashboardProps) {
  const [stats, setStats] = useState<OperationStats[]>([]);
  const [connectors, setConnectors] = useState<ConnectorBreakdown[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowMinutes, setWindowMinutes] = useState(60);

  const fetchData = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`/api/v1/performance/stats?window=${windowMinutes}`, {
          headers: { 'x-workspace-id': workspaceId },
        }),
        fetch(`/api/v1/performance/connectors?window=${windowMinutes}`, {
          headers: { 'x-workspace-id': workspaceId },
        }),
      ]);
      if (sRes.ok) setStats(((await sRes.json()) as { data: OperationStats[] }).data);
      if (cRes.ok) setConnectors(((await cRes.json()) as { data: ConnectorBreakdown[] }).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, windowMinutes]);

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const maxP95 = Math.max(...stats.map((s) => s.percentiles.p95), 1);
  const maxConnP95 = Math.max(...connectors.map((c) => c.p95Ms), 1);

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {[15, 60, 360].map((m) => (
          <button
            key={m}
            onClick={() => setWindowMinutes(m)}
            className={`rounded px-3 py-1 text-sm ${windowMinutes === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          >
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
      </div>

      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>Operation Latencies</CardTitle>
          <CardDescription>p50 / p95 / p99 in the last {windowMinutes} min — sorted by slowest p95</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No samples in this window.</p>
          ) : (
            <div className="space-y-4">
              {stats.map((s, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{OPERATION_LABELS[s.operation] ?? s.operation}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge className={`text-xs ${latencyBadgeClass(s.percentiles.p50)}`}>p50 {s.percentiles.p50.toFixed(0)}ms</Badge>
                      <Badge className={`text-xs ${latencyBadgeClass(s.percentiles.p95)}`}>p95 {s.percentiles.p95.toFixed(0)}ms</Badge>
                      <Badge className={`text-xs ${latencyBadgeClass(s.percentiles.p99)}`}>p99 {s.percentiles.p99.toFixed(0)}ms</Badge>
                      <span className="text-xs text-muted-foreground">{s.percentiles.count} samples</span>
                    </div>
                  </div>
                  <LatencyBar value={s.percentiles.p95} max={maxP95} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per-Connector Breakdown</CardTitle>
          <CardDescription>Ranked by p95 sync latency</CardDescription>
        </CardHeader>
        <CardContent>
          {connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connector samples in this window.</p>
          ) : (
            <div className="space-y-3">
              {connectors.map((c) => (
                <div key={c.connectorId} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs">{c.connectorId}</span>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${latencyBadgeClass(c.p95Ms)}`}>p95 {c.p95Ms.toFixed(0)}ms</Badge>
                      <span className="text-xs text-muted-foreground">{c.sampleCount} samples</span>
                    </div>
                  </div>
                  <LatencyBar value={c.p95Ms} max={maxConnP95} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
