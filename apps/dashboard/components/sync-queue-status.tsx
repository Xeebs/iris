'use client';

interface QueueStats {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface ActiveJob {
  jobId: string;
  connectorInstanceId: string;
  workspaceId: string;
  state: 'active' | 'waiting';
  progress: number;
  elapsedMs: number;
}

interface SyncQueueStatusProps {
  stats: QueueStats | null;
  activeJobs: ActiveJob[];
  loading?: boolean;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border rounded p-3 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function progressBar(pct: number) {
  return (
    <div className="w-full bg-muted rounded-full h-1.5">
      <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

export function SyncQueueStatus({ stats, activeJobs, loading }: SyncQueueStatusProps) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading queue status…</p>;

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="Active" value={stats.active} color="text-blue-600" />
          <StatCard label="Waiting" value={stats.waiting} color="text-yellow-600" />
          <StatCard label="Delayed" value={stats.delayed} color="text-orange-500" />
          <StatCard label="Completed" value={stats.completed} color="text-green-600" />
          <StatCard label="Failed" value={stats.failed} color="text-red-600" />
        </div>
      )}

      {activeJobs.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">In-Flight Jobs ({activeJobs.length})</p>
          <div className="space-y-2">
            {activeJobs.map((job) => (
              <div key={job.jobId} className="border rounded p-2 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-muted-foreground truncate max-w-[200px]">{job.connectorInstanceId}</span>
                  <span className={`font-medium ${job.state === 'active' ? 'text-blue-600' : 'text-yellow-600'}`}>
                    {job.state}
                  </span>
                  <span className="text-muted-foreground">{Math.round(job.elapsedMs / 1000)}s</span>
                </div>
                {job.state === 'active' && progressBar(job.progress)}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeJobs.length === 0 && stats && stats.active === 0 && (
        <p className="text-xs text-muted-foreground">No active jobs.</p>
      )}
    </div>
  );
}
