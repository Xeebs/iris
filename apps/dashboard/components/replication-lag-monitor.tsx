'use client';

type ReplicationStatus = {
  regionId: string;
  lagMs: number | null;
  status: 'healthy' | 'degraded' | 'unreachable';
  lastSyncAt: string | null;
  checkedAt: string;
};

function statusColor(status: string) {
  if (status === 'healthy') return 'text-green-400';
  if (status === 'degraded') return 'text-yellow-400';
  return 'text-red-400';
}

function lagBar(lagMs: number | null, maxMs = 10000) {
  if (lagMs === null) return null;
  const pct = Math.min((lagMs / maxMs) * 100, 100);
  const color = lagMs < 1000 ? 'bg-green-500' : lagMs < 5000 ? 'bg-yellow-500' : 'bg-red-500';
  return { pct, color };
}

export function ReplicationLagMonitor({ replicas }: { replicas: ReplicationStatus[] }) {
  if (replicas.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
        No replica regions configured. This instance is running standalone.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {replicas.map((r) => {
        const bar = lagBar(r.lagMs);
        const lagText = r.lagMs === null ? 'unknown' : r.lagMs < 1000 ? `${r.lagMs}ms` : `${(r.lagMs / 1000).toFixed(1)}s`;
        return (
          <div key={r.regionId} className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-medium text-zinc-200">{r.regionId}</span>
                <span className={`ml-2 text-xs ${statusColor(r.status)}`}>{r.status}</span>
              </div>
              <span className="text-xs text-zinc-400">Lag: {lagText}</span>
            </div>
            {bar && (
              <div className="h-2 bg-zinc-700 rounded overflow-hidden">
                <div className={`h-full rounded ${bar.color} transition-all`} style={{ width: `${bar.pct}%` }} />
              </div>
            )}
            <div className="text-xs text-zinc-600 mt-1">
              Checked {new Date(r.checkedAt).toLocaleTimeString()}
              {r.lastSyncAt && ` · Last sync ${new Date(r.lastSyncAt).toLocaleTimeString()}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
