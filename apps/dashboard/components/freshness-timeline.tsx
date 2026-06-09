'use client';

import { useEffect, useState } from 'react';

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

// ─── SLA-aware timeline (live, API-fetched) ───────────────────────────────────

type AgeBreakpoint = { entityType: string; meanAgeSec: number; count: number };

type FreshnessTimelineApiProps = {
  connectorId: string;
  intervalDays?: number;
};

/**
 * Fetches live freshness metrics and renders age per entity type with SLA-breach colouring.
 */
export function FreshnessSlaTimeline({ connectorId, intervalDays = 7 }: FreshnessTimelineApiProps) {
  const [breakdown, setBreakdown] = useState<AgeBreakpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/freshness/metrics/${connectorId}?intervalDays=${intervalDays}`)
      .then((r) => r.json())
      .then((body) => setBreakdown(body.data?.entityTypeBreakdown ?? []))
      .catch(() => setFetchError('Failed to load freshness data'))
      .finally(() => setLoading(false));
  }, [connectorId, intervalDays]);

  function formatAge(sec: number): string {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h`;
    return `${Math.round(sec / 86400)}d`;
  }

  const maxAge = Math.max(...breakdown.map((b) => b.meanAgeSec), 1);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 rounded bg-gray-100" />
        ))}
      </div>
    );
  }

  if (fetchError) {
    return <p className="text-sm text-red-600">{fetchError}</p>;
  }

  return (
    <div className="space-y-3">
      {breakdown.map((b) => {
        const pct = Math.round((b.meanAgeSec / maxAge) * 100);
        const warn = b.meanAgeSec > 3600;
        const breach = b.meanAgeSec > 86400;
        const color = breach ? 'bg-red-500' : warn ? 'bg-amber-400' : 'bg-green-400';
        return (
          <div key={b.entityType}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="capitalize text-gray-700">{b.entityType}</span>
              <span className={breach ? 'text-red-600' : warn ? 'text-amber-600' : 'text-green-600'}>
                {formatAge(b.meanAgeSec)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {breakdown.length === 0 && (
        <p className="text-sm text-gray-400">No freshness data.</p>
      )}
    </div>
  );
}
