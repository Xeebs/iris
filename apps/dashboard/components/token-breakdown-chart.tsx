'use client';

export interface BreakdownBucket {
  bucket: string;
  groups: Record<string, { tokensSpent: number; tokensSaved: number; queryCount: number }>;
}

type Props = {
  buckets: BreakdownBucket[];
  groupNames: string[];
};

const GROUP_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1',
];

function formatBucket(b: string): string {
  const d = new Date(b);
  if (isNaN(d.getTime())) return b;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TokenBreakdownChart({ buckets, groupNames }: Props) {
  if (buckets.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400">
        No data for the selected time range.
      </div>
    );
  }

  const maxSpent = Math.max(
    1,
    ...buckets.map((b) =>
      Object.values(b.groups).reduce((s, g) => s + g.tokensSpent, 0),
    ),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {groupNames.map((name, i) => (
          <div key={name} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length] }} />
            <span className="text-xs text-gray-600">{name}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {buckets.map((b) => {
          const total = Object.values(b.groups).reduce((s, g) => s + g.tokensSpent, 0);
          const barWidth = maxSpent > 0 ? (total / maxSpent) * 100 : 0;

          return (
            <div key={b.bucket} className="flex items-center gap-3">
              <span className="w-16 text-right text-xs text-gray-400 shrink-0">
                {formatBucket(b.bucket)}
              </span>
              <div className="flex-1 relative">
                <div
                  className="flex h-6 rounded overflow-hidden"
                  style={{ width: `${barWidth}%`, minWidth: total > 0 ? 2 : 0 }}
                  title={`${total.toLocaleString()} tokens`}
                >
                  {groupNames.map((name, i) => {
                    const g = b.groups[name];
                    if (!g || g.tokensSpent === 0) return null;
                    const segPct = total > 0 ? (g.tokensSpent / total) * 100 : 0;
                    return (
                      <div
                        key={name}
                        style={{
                          width: `${segPct}%`,
                          backgroundColor: GROUP_COLORS[i % GROUP_COLORS.length],
                        }}
                        title={`${name}: ${g.tokensSpent.toLocaleString()} tokens (${g.queryCount} queries)`}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="w-20 text-xs text-gray-500 tabular-nums shrink-0">
                {total.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
