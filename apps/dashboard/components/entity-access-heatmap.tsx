'use client';

interface EntityAccessEntry {
  entityId: string;
  accessCount: number;
  lastAccessed: string;
}

interface EntityAccessHeatmapProps {
  entries: EntityAccessEntry[];
  loading: boolean;
}

function heatColor(count: number, max: number): string {
  const intensity = Math.round((count / max) * 5);
  const colors = [
    'bg-blue-50 text-blue-700',
    'bg-blue-100 text-blue-800',
    'bg-blue-200 text-blue-900',
    'bg-blue-400 text-white',
    'bg-blue-600 text-white',
    'bg-blue-800 text-white',
  ];
  return colors[intensity] ?? colors[0] ?? '';
}

export function EntityAccessHeatmap({ entries, loading }: EntityAccessHeatmapProps) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading entity access data…</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No entity access data available.</p>;

  const max = entries.reduce((m, e) => Math.max(m, e.accessCount), 0);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Top {entries.length} most-accessed entities — color intensity indicates access frequency.</p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        {entries.slice(0, 40).map((entry) => (
          <div
            key={entry.entityId}
            className={`rounded p-2 text-xs ${heatColor(entry.accessCount, max)}`}
            title={`${entry.entityId}: ${entry.accessCount} accesses`}
          >
            <p className="font-mono truncate text-[10px] opacity-80">{entry.entityId.split(':').slice(-2).join(':')}</p>
            <p className="font-bold mt-1">{entry.accessCount}×</p>
          </div>
        ))}
      </div>
    </div>
  );
}
