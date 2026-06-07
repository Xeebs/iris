'use client';

import { useEffect, useRef, useState } from 'react';
import { SyncQueueStatus } from './sync-queue-status.js';
import { EntityThroughputGauge } from './entity-throughput-gauge.js';

interface MonitoringStatus {
  queue: { active: number; waiting: number; completed: number; failed: number; delayed: number };
  activeJobs: Array<{
    jobId: string;
    connectorInstanceId: string;
    workspaceId: string;
    state: 'active' | 'waiting';
    progress: number;
    elapsedMs: number;
  }>;
  recentSyncs: Array<{
    job_id: string;
    connector_instance_id: string;
    total_duration_ms: number | null;
    entities_synced: number;
    error_count: number;
    status: string;
    started_at: string;
  }>;
  connectorThroughput: Array<{
    connector_instance_id: string;
    total_entities: number;
    avg_duration_ms: number | null;
    error_rate: number;
    last_sync: string | null;
  }>;
  throughputPerSecond: number;
  generatedAt: string;
}

interface SyncMonitoringDashboardProps {
  apiBase?: string;
  refreshIntervalMs?: number;
}

export function SyncMonitoringDashboard({
  apiBase = '/api/v1',
  refreshIntervalMs = 5000,
}: SyncMonitoringDashboardProps) {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchStatus() {
    try {
      const res = await fetch(`${apiBase}/admin/sync-monitoring/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: MonitoringStatus };
      setStatus(json.data);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch monitoring status');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchStatus();
    intervalRef.current = setInterval(() => void fetchStatus(), refreshIntervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [apiBase, refreshIntervalMs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Live Sync Monitoring</h2>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground">
              Last refreshed: {lastRefresh.toLocaleTimeString()} · auto-refresh every {refreshIntervalMs / 1000}s
            </p>
          )}
        </div>
        <button
          onClick={() => void fetchStatus()}
          className="text-xs px-3 py-1.5 border rounded hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded p-4 space-y-2">
          <h3 className="text-sm font-medium">Queue Status</h3>
          <SyncQueueStatus
            stats={status?.queue ?? null}
            activeJobs={status?.activeJobs ?? []}
            loading={loading}
          />
        </div>

        <div className="border rounded p-4 space-y-2">
          <h3 className="text-sm font-medium">Entity Throughput</h3>
          <EntityThroughputGauge
            throughputPerSecond={status?.throughputPerSecond ?? 0}
            connectorThroughput={status?.connectorThroughput ?? []}
            loading={loading}
          />
        </div>
      </div>

      {status && status.recentSyncs.length > 0 && (
        <div className="border rounded p-4">
          <h3 className="text-sm font-medium mb-3">Recent Syncs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left pb-2">Connector</th>
                  <th className="text-right pb-2">Entities</th>
                  <th className="text-right pb-2">Duration</th>
                  <th className="text-right pb-2">Errors</th>
                  <th className="text-right pb-2">Status</th>
                  <th className="text-right pb-2">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {status.recentSyncs.map((sync) => (
                  <tr key={sync.job_id}>
                    <td className="py-1.5 font-mono truncate max-w-[140px]">{sync.connector_instance_id.split('-')[0]}</td>
                    <td className="py-1.5 text-right">{sync.entities_synced.toLocaleString()}</td>
                    <td className="py-1.5 text-right">
                      {sync.total_duration_ms ? `${(sync.total_duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className={`py-1.5 text-right ${sync.error_count > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {sync.error_count}
                    </td>
                    <td className="py-1.5 text-right">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium
                        ${sync.status === 'completed' ? 'bg-green-100 text-green-700'
                          : sync.status === 'failed' ? 'bg-red-100 text-red-700'
                          : 'bg-blue-100 text-blue-700'}`}>
                        {sync.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {new Date(sync.started_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
