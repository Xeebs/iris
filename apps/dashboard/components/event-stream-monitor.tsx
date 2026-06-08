'use client';

import { useState } from 'react';

type ChangeType = 'entity_created' | 'entity_updated' | 'entity_deleted' | 'relationship_changed';

type AuditEntry = {
  eventId: string;
  connectorId: string;
  entityId: string;
  changeType: ChangeType;
  changeSummary: string;
  deliveredAt: string | null;
  latencyMs: number | null;
};

type EventStreamMonitorProps = {
  workspaceId: string;
  initialEntries?: AuditEntry[];
};

const CHANGE_TYPE_COLORS: Record<ChangeType, string> = {
  entity_created: 'bg-green-100 text-green-700',
  entity_updated: 'bg-blue-100 text-blue-700',
  entity_deleted: 'bg-red-100 text-red-700',
  relationship_changed: 'bg-purple-100 text-purple-700',
};

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) return <span className="text-gray-300 text-xs">—</span>;
  const color = ms < 100 ? 'text-green-600' : ms < 500 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`text-xs font-mono ${color}`}>{ms}ms</span>;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx]!;
}

export function EventStreamMonitor({ workspaceId, initialEntries = [] }: EventStreamMonitorProps) {
  const [entries, setEntries] = useState<AuditEntry[]>(initialEntries);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchEntries(cursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/v1/events/audit', window.location.origin);
      url.searchParams.set('limit', '50');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: AuditEntry[]; meta: { hasMore: boolean; nextCursor: string | null } };
      setEntries(prev => cursor ? [...prev, ...body.data] : body.data);
      setNextCursor(body.meta.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  const latencies = entries.map(e => e.latencyMs).filter((v): v is number => v !== null);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  const typeCounts = entries.reduce<Partial<Record<ChangeType, number>>>((acc, e) => {
    acc[e.changeType] = (acc[e.changeType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Event Stream Monitor</h2>
          <p className="text-xs text-gray-500 mt-0.5">Real-time entity change event ingestion log</p>
        </div>
        <button
          onClick={() => fetchEntries()}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Latency stats */}
      {latencies.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <div className="text-xl font-bold text-gray-800">{entries.length}</div>
            <div className="text-xs text-gray-500 mt-0.5">Total events</div>
          </div>
          {[['P50', p50], ['P95', p95], ['P99', p99]].map(([label, val]) => (
            <div key={label as string} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className={`text-xl font-bold ${(val as number) < 100 ? 'text-green-600' : (val as number) < 500 ? 'text-yellow-600' : 'text-red-600'}`}>
                {val}ms
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Latency {label as string}</div>
            </div>
          ))}
        </div>
      )}

      {/* Change type breakdown */}
      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(Object.entries(typeCounts) as Array<[ChangeType, number]>).map(([type, count]) => (
            <span key={type} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${CHANGE_TYPE_COLORS[type]}`}>
              {type.replace('_', ' ')}
              <span className="font-bold">{count}</span>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Audit log table */}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        {entries.length === 0 && !loading ? (
          <div className="py-10 text-center text-sm text-gray-400">
            No events yet.{' '}
            <button onClick={() => fetchEntries()} className="underline hover:text-gray-600">
              Load audit log
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Event</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Connector</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Summary</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Latency</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.eventId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 truncate max-w-[100px]" title={e.eventId}>
                    {e.eventId.slice(0, 12)}…
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${CHANGE_TYPE_COLORS[e.changeType]}`}>
                      {e.changeType.split('_').slice(1).join(' ')}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{e.connectorId}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-700 max-w-[200px] truncate" title={e.changeSummary}>
                    {e.changeSummary}
                  </td>
                  <td className="px-4 py-2.5">
                    <LatencyBadge ms={e.latencyMs} />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {e.deliveredAt ? new Date(e.deliveredAt).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {nextCursor && (
        <div className="text-center">
          <button
            onClick={() => fetchEntries(nextCursor)}
            disabled={loading}
            className="text-xs px-4 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
