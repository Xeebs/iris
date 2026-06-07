'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { HealthStatusBadge, type HealthStatus } from '../../../../components/health-status-badge.js';
import { ErrorLogViewer, type SyncLogEntry } from '../../../../components/error-log-viewer.js';
import { SyncHistoryChart, type SyncDaySummary } from '../../../../components/sync-history-chart.js';

interface ConnectorHealth {
  instanceId: string;
  workspaceId: string;
  status: HealthStatus;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface ConnectorInstance {
  id: string;
  connectorId: string;
  workspaceId: string;
  status: string;
  lastSyncedAt: string | null;
}

const API_URL = typeof process !== 'undefined'
  ? (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1')
  : '/api/v1';

const WORKSPACE_ID = typeof process !== 'undefined'
  ? (process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default')
  : 'default';

function buildSyncHistory(logs: SyncLogEntry[]): SyncDaySummary[] {
  const byDay = new Map<string, { total: number; succeeded: number; failed: number }>();
  for (const e of logs) {
    const day = e.timestamp.slice(0, 10);
    const entry = byDay.get(day) ?? { total: 0, succeeded: 0, failed: 0 };
    entry.total++;
    if (e.eventType === 'completed') entry.succeeded++;
    if (e.eventType === 'failed') entry.failed++;
    byDay.set(day, entry);
  }
  return Array.from(byDay.entries())
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export default function ConnectorHealthPage({
  params,
}: {
  params: { id: string };
}): React.JSX.Element {
  const { id } = params;

  const [instance, setInstance] = useState<ConnectorInstance | null>(null);
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [logCursor, setLogCursor] = useState<string | undefined>();
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);

  const loadLogs = useCallback(async (cursor?: string) => {
    setLogsLoading(true);
    try {
      const qs = new URLSearchParams({ workspaceId: WORKSPACE_ID, limit: '50', severity: 'warn' });
      if (cursor) qs.set('cursor', cursor);
      const res = await fetch(`${API_URL}/connectors/${id}/sync-logs?${qs.toString()}`);
      if (!res.ok) return;
      const body = await res.json() as { data: SyncLogEntry[]; meta: { hasMore: boolean; nextCursor?: string } };
      setLogs((prev) => cursor ? [...prev, ...body.data] : body.data);
      setHasMoreLogs(body.meta.hasMore);
      setLogCursor(body.meta.nextCursor);
    } finally {
      setLogsLoading(false);
    }
  }, [id]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [instRes, healthRes] = await Promise.all([
        fetch(`${API_URL}/connectors/instances/${id}?workspaceId=${WORKSPACE_ID}`),
        fetch(`${API_URL}/connectors/${id}/health?workspaceId=${WORKSPACE_ID}`),
      ]);
      if (instRes.ok) {
        const b = await instRes.json() as { data: ConnectorInstance };
        setInstance(b.data);
      }
      if (healthRes.ok) {
        const b = await healthRes.json() as { data: ConnectorHealth };
        setHealth(b.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
    await loadLogs();
  }, [id, loadLogs]);

  useEffect(() => { void load(); }, [load]);

  async function handleRetry() {
    setRetrying(true);
    setRetryMsg(null);
    try {
      const res = await fetch(`${API_URL}/connectors/${id}/health/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRetryMsg('Retry queued successfully. Refresh in a moment to see updated status.');
    } catch (e) {
      setRetryMsg(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  const historyDays = buildSyncHistory(logs);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Link href="/" className="hover:text-gray-700">Dashboard</Link>
          <span>/</span>
          <Link href="/connectors" className="hover:text-gray-700">Connectors</Link>
          <span>/</span>
          <span className="text-gray-700 font-mono">{id}</span>
          <span>/</span>
          <span className="text-gray-700">Health</span>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Connector Health</h1>
            {instance && (
              <p className="text-sm text-gray-500 mt-1">
                {instance.connectorId} · {instance.id}
              </p>
            )}
          </div>
          <HealthStatusBadge status={health?.status ?? 'unknown'} />
        </div>
      </header>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Last Checked</p>
              <p className="text-sm font-medium text-gray-800">
                {health?.checkedAt ? new Date(health.checkedAt).toLocaleString() : '—'}
              </p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Latency</p>
              <p className="text-sm font-medium text-gray-800">
                {health?.latencyMs != null ? `${health.latencyMs} ms` : '—'}
              </p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Last Synced</p>
              <p className="text-sm font-medium text-gray-800">
                {instance?.lastSyncedAt ? new Date(instance.lastSyncedAt).toLocaleString() : 'Never'}
              </p>
            </div>
            <div className="bg-white border rounded-lg p-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Connector Status</p>
              <p className="text-sm font-medium text-gray-800">{instance?.status ?? '—'}</p>
            </div>
          </div>

          {health?.errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-xs font-medium text-red-600 mb-1">Error</p>
              <pre className="text-sm text-red-700 whitespace-pre-wrap break-words font-mono">
                {health.errorMessage}
              </pre>
            </div>
          )}

          <div className="bg-white border rounded-lg p-4">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-semibold text-gray-700">Manual Retry</p>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Re-queue a full sync for this connector instance.
            </p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {retrying ? 'Queueing…' : 'Retry Sync'}
            </button>
            {retryMsg && <p className="mt-2 text-xs text-gray-600">{retryMsg}</p>}
          </div>

          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Sync Success Rate — Last 30 Days</h2>
            <SyncHistoryChart days={historyDays} />
          </div>

          <div className="bg-white border rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Error Log</h2>
            <ErrorLogViewer
              logs={logs.filter((l) => l.severity === 'error' || l.severity === 'warn')}
              hasMore={hasMoreLogs}
              onLoadMore={() => loadLogs(logCursor)}
              loading={logsLoading}
            />
          </div>
        </div>
      )}
    </main>
  );
}
