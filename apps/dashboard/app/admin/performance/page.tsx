'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SyncThroughputChart, SyncDurationDistribution } from '@/components/performance-charts';

interface ConnectorSummary {
  connector_instance_id: string;
  sync_count: number;
  avg_duration_ms: number | null;
  p50_ms: number | null;
  p90_ms: number | null;
  total_entities: number;
  total_errors: number;
  failed_count: number;
  last_sync_at: string | null;
}

interface SyncRecord {
  id: string;
  jobId: string;
  connectorInstanceId: string;
  totalDurationMs: number | null;
  apiTimeMs: number | null;
  indexingTimeMs: number | null;
  embeddingTimeMs: number | null;
  apiCalls: number;
  entitiesSynced: number;
  avgEntitySizeBytes: number | null;
  peakMemoryMb: number | null;
  errorCount: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

interface PerformanceDetails {
  connectorInstanceId: string;
  periodDays: number;
  syncs: SyncRecord[];
  aggregates: {
    totalSyncs: number;
    avgDurationMs: number | null;
    p50DurationMs: number | null;
    p90DurationMs: number | null;
    p99DurationMs: number | null;
    totalEntitiesSynced: number;
    avgEntitiesPerSync: number | null;
    totalErrors: number;
    failedSyncs: number;
    avgPeakMemoryMb: number | null;
  } | null;
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'completed') return 'default';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

export default function PerformanceDashboardPage() {
  const [days, setDays] = useState('30');
  const [summary, setSummary] = useState<ConnectorSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<PerformanceDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchSummary();
  }, [days]);

  useEffect(() => {
    if (selected) {
      void fetchDetails(selected);
    }
  }, [selected, days]);

  async function fetchSummary() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/performance/summary?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch summary');
      const data = (await res.json()) as { data: { connectors: ConnectorSummary[] } };
      setSummary(data.data.connectors);
      const first = data.data.connectors[0];
      if (first && !selected) {
        setSelected(first.connector_instance_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }

  async function fetchDetails(connectorId: string) {
    try {
      const res = await fetch(`/api/v1/admin/performance/connectors/${connectorId}?days=${days}`);
      if (!res.ok) throw new Error('Failed to fetch details');
      const data = (await res.json()) as { data: PerformanceDetails };
      setDetails(data.data);
    } catch {
      setDetails(null);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading performance data…</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Connector Performance</h1>
          <p className="text-muted-foreground">Sync duration, throughput, and error rates across all connectors.</p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {summary.length === 0 && !error && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No sync performance data available for this period.
          </CardContent>
        </Card>
      )}

      {summary.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Connector list */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Connectors</h2>
            {summary.map((conn) => (
              <Card
                key={conn.connector_instance_id}
                className={`cursor-pointer border-2 transition-colors ${selected === conn.connector_instance_id ? 'border-primary' : 'hover:border-muted-foreground/40'}`}
                onClick={() => setSelected(conn.connector_instance_id)}
              >
                <CardHeader className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-medium truncate">{conn.connector_instance_id.slice(0, 16)}…</CardTitle>
                    {conn.failed_count > 0 && <Badge variant="destructive">{conn.failed_count} failed</Badge>}
                  </div>
                  <CardDescription className="text-xs">
                    {conn.sync_count} syncs · avg {formatMs(conn.avg_duration_ms)}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2 space-y-4">
            {details && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Total syncs" value={String(details.aggregates?.totalSyncs ?? 0)} />
                  <StatCard label="Avg duration" value={formatMs(details.aggregates?.avgDurationMs)} />
                  <StatCard label="Total entities" value={(details.aggregates?.totalEntitiesSynced ?? 0).toLocaleString()} />
                  <StatCard label="Errors" value={String(details.aggregates?.totalErrors ?? 0)} highlight={!!details.aggregates?.totalErrors} />
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Throughput over time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SyncThroughputChart data={details.syncs} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Latency percentiles</CardTitle>
                    <CardDescription className="text-xs">p50 / p90 / p99 sync duration</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <SyncDurationDistribution data={details.aggregates ? {
                      p50DurationMs: details.aggregates.p50DurationMs,
                      p90DurationMs: details.aggregates.p90DurationMs,
                      p99DurationMs: details.aggregates.p99DurationMs,
                    } : null} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recent syncs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      {details.syncs.slice(0, 10).map((sync) => (
                        <div key={sync.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                          <div className="flex items-center gap-2">
                            <Badge variant={statusVariant(sync.status)} className="text-xs">{sync.status}</Badge>
                            <span className="text-muted-foreground text-xs">{new Date(sync.startedAt).toLocaleString()}</span>
                          </div>
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>{formatMs(sync.totalDurationMs)}</span>
                            <span>{sync.entitiesSynced} entities</span>
                            {sync.errorCount > 0 && <span className="text-destructive">{sync.errorCount} errors</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold mt-1 ${highlight ? 'text-destructive' : ''}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
