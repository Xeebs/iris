'use client';

interface FreshnessSnapshot {
  date: string;
  totalEntities: number;
}

interface FreshnessTimelineProps {
  snapshots: FreshnessSnapshot[];
  pctUpdatedLast7Days: number;
  pctUpdatedLast30Days: number;
  avgAgeByType: Record<string, number>;
}

function SparkLine({ snapshots }: { snapshots: FreshnessSnapshot[] }) {
  if (snapshots.length < 2) {
    return <div className="flex h-16 items-center justify-center text-xs text-gray-400">Not enough history</div>;
  }

  const width = 300;
  const height = 64;
  const max = Math.max(...snapshots.map((s) => s.totalEntities), 1);
  const points = snapshots.map((s, i) => {
    const x = (i / (snapshots.length - 1)) * width;
    const y = height - (s.totalEntities / max) * height * 0.9;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#6366f1"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points={`0,${height} ${points.join(' ')} ${width},${height}`}
        fill="rgba(99,102,241,0.1)"
        stroke="none"
      />
    </svg>
  );
}

function FreshnessBar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium" style={{ color }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

/**
 * Renders entity freshness metrics: a sparkline of index growth and freshness bars by time window.
 */
export function FreshnessTimeline({
  snapshots,
  pctUpdatedLast7Days,
  pctUpdatedLast30Days,
  avgAgeByType,
}: FreshnessTimelineProps) {
  const ageEntries = Object.entries(avgAgeByType).slice(0, 5);

  return (
    <div className="space-y-5">
      {/* Growth sparkline */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-gray-700">Index Growth (30d)</h4>
        <SparkLine snapshots={snapshots} />
        {snapshots.length >= 2 && (
          <p className="mt-1 text-xs text-gray-400">
            {snapshots[0]?.totalEntities?.toLocaleString()} → {snapshots[snapshots.length - 1]?.totalEntities?.toLocaleString()} entities
          </p>
        )}
      </div>

      {/* Freshness bars */}
      <div className="space-y-3">
        <FreshnessBar label="Updated in last 7 days" pct={pctUpdatedLast7Days} color="#10b981" />
        <FreshnessBar label="Updated in last 30 days" pct={pctUpdatedLast30Days} color="#6366f1" />
      </div>

      {/* Avg age by type */}
      {ageEntries.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-gray-700">Average Age by Type</h4>
          <dl className="space-y-1">
            {ageEntries.map(([type, days]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <dt className="capitalize text-gray-600">{type}</dt>
                <dd className={`font-medium ${days > 30 ? 'text-orange-500' : 'text-gray-700'}`}>
                  {days.toFixed(0)}d
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
