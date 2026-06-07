'use client';

export interface SyncDaySummary {
  date: string;
  total: number;
  succeeded: number;
  failed: number;
}

type Props = {
  days: SyncDaySummary[];
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SyncHistoryChart({ days }: Props) {
  if (days.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-400">No sync history yet.</p>;
  }

  const maxTotal = Math.max(1, ...days.map((d) => d.total));

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs mb-2">
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-green-500" /><span className="text-gray-600">Succeeded</span></div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-red-400" /><span className="text-gray-600">Failed</span></div>
      </div>

      {days.map((d) => {
        const barWidth = (d.total / maxTotal) * 100;
        const succeedPct = d.total > 0 ? (d.succeeded / d.total) * 100 : 0;
        const failPct = d.total > 0 ? (d.failed / d.total) * 100 : 0;
        const successRate = d.total > 0 ? Math.round((d.succeeded / d.total) * 100) : 0;

        return (
          <div key={d.date} className="flex items-center gap-3">
            <span className="w-16 text-right text-xs text-gray-400 shrink-0">{formatDate(d.date)}</span>
            <div className="flex-1">
              <div
                className="flex h-5 rounded overflow-hidden"
                style={{ width: `${barWidth}%`, minWidth: d.total > 0 ? 2 : 0 }}
                title={`${d.succeeded} succeeded, ${d.failed} failed`}
              >
                {succeedPct > 0 && (
                  <div className="bg-green-500" style={{ width: `${succeedPct}%` }} />
                )}
                {failPct > 0 && (
                  <div className="bg-red-400" style={{ width: `${failPct}%` }} />
                )}
              </div>
            </div>
            <span className="w-16 text-xs text-gray-500 tabular-nums shrink-0 text-right">
              {successRate}% ({d.total})
            </span>
          </div>
        );
      })}
    </div>
  );
}
