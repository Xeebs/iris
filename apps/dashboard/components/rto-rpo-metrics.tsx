'use client';

type RtoRpoMetrics = {
  estimatedRpoHours: number;
  estimatedRtoMinutes: number;
  lastBackupAt: string | null;
  backupCount: { full: number; incremental: number };
};

function MetricCard({ label, value, subtext, status }: { label: string; value: string; subtext: string; status: 'ok' | 'warn' | 'bad' }) {
  const colors = { ok: 'text-green-400', warn: 'text-yellow-400', bad: 'text-red-400' };
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <div className="text-xs text-zinc-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colors[status]}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{subtext}</div>
    </div>
  );
}

export function RtoRpoMetrics({ metrics }: { metrics: RtoRpoMetrics | null }) {
  if (!metrics) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-zinc-400 text-sm">
        No backup metrics available. Create a full backup to start tracking RTO/RPO.
      </div>
    );
  }

  const rpoStatus = metrics.estimatedRpoHours < 1 ? 'ok' : metrics.estimatedRpoHours < 6 ? 'warn' : 'bad';
  const rtoStatus = metrics.estimatedRtoMinutes < 5 ? 'ok' : metrics.estimatedRtoMinutes < 30 ? 'warn' : 'bad';

  const lastBackup = metrics.lastBackupAt
    ? new Date(metrics.lastBackupAt).toLocaleString()
    : 'Never';

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <MetricCard
        label="Estimated RPO"
        value={metrics.estimatedRpoHours === 999 ? '∞' : `${metrics.estimatedRpoHours.toFixed(1)}h`}
        subtext="Max data loss if failure occurs now"
        status={rpoStatus}
      />
      <MetricCard
        label="Estimated RTO"
        value={`${metrics.estimatedRtoMinutes}m`}
        subtext="Estimated time to recover"
        status={rtoStatus}
      />
      <MetricCard
        label="Full Backups"
        value={String(metrics.backupCount.full)}
        subtext="Ready full backup snapshots"
        status={metrics.backupCount.full > 0 ? 'ok' : 'bad'}
      />
      <MetricCard
        label="Incrementals"
        value={String(metrics.backupCount.incremental)}
        subtext={`Last backup: ${lastBackup}`}
        status="ok"
      />
    </div>
  );
}
