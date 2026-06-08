'use client';

import { useEffect, useState } from 'react';
import { ReplicationLagMonitor } from '../../../components/replication-lag-monitor.js';
import { FailoverControlPanel } from '../../../components/failover-control-panel.js';

type ReplicationStatus = {
  regionId: string;
  lagMs: number | null;
  status: 'healthy' | 'degraded' | 'unreachable';
  lastSyncAt: string | null;
  checkedAt: string;
};

type FailoverEvent = {
  id: string;
  fromRegion: string;
  toRegion: string;
  reason: string;
  lagAtFailoverMs: number | null;
  durationMs: number | null;
  initiatedBy: string;
  occurredAt: string;
};

type HaStatus = {
  primaryRegion: { regionId: string; role: 'primary' | 'replica' } | null;
  replicaRegions: ReplicationStatus[];
  lastFailover: FailoverEvent | null;
  overallStatus: 'healthy' | 'degraded' | 'unreachable';
};

const STATUS_COLORS = {
  healthy: 'text-green-400 bg-green-500/10 border-green-500/30',
  degraded: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  unreachable: 'text-red-400 bg-red-500/10 border-red-500/30',
};

export default function HaConfigPage() {
  const [haStatus, setHaStatus] = useState<HaStatus | null>(null);
  const [history, setHistory] = useState<FailoverEvent[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const [statusRes, historyRes] = await Promise.all([
      fetch('/api/v1/ha/status'),
      fetch('/api/v1/ha/history'),
    ]);
    if (statusRes.ok) {
      const json = await statusRes.json();
      setHaStatus(json.data);
    }
    if (historyRes.ok) {
      const json = await historyRes.json();
      setHistory(json.data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  async function handleFailover(toRegion: string) {
    if (!haStatus?.primaryRegion) return;
    await fetch('/api/v1/ha/failover', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromRegion: haStatus.primaryRegion.regionId,
        toRegion,
        reason: 'manual',
        confirmedBy: 'dashboard',
      }),
    });
    await refresh();
  }

  if (loading) {
    return <div className="p-6 text-zinc-500 text-sm">Loading HA configuration…</div>;
  }

  const overallStatus = haStatus?.overallStatus ?? 'healthy';

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">High-Availability Config</h1>
          <p className="text-sm text-zinc-400 mt-1">Multi-region failover and replication monitoring.</p>
        </div>
        <span className={`px-3 py-1 text-sm rounded border ${STATUS_COLORS[overallStatus]}`}>
          {overallStatus}
        </span>
      </div>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Replication Status</h2>
        <ReplicationLagMonitor replicas={haStatus?.replicaRegions ?? []} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Failover Control</h2>
        <FailoverControlPanel
          primaryRegion={haStatus?.primaryRegion ?? null}
          replicas={haStatus?.replicaRegions ?? []}
          onFailover={handleFailover}
        />
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Failover History</h2>
        {history.length === 0 ? (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
            No failovers recorded.
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700">
            {history.map((ev) => (
              <div key={ev.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm text-zinc-200">
                    <span className="font-mono">{ev.fromRegion}</span>
                    {' → '}
                    <span className="font-mono">{ev.toRegion}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {new Date(ev.occurredAt).toLocaleString()} · {ev.reason} · by {ev.initiatedBy}
                  </div>
                </div>
                <div className="text-xs text-zinc-400">
                  {ev.durationMs !== null ? `${ev.durationMs}ms` : '—'}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
