'use client';

import { useState, useEffect } from 'react';

type DayBucket = {
  date: string;
  entityType: string;
  count: number;
};

type HeatmapCell = {
  value: number;
  date: string;
  entityType: string;
};

// Aggregate change events into a day × entity-type heatmap
function buildHeatmap(changes: Array<{ changedAt: string; entityType: string }>): {
  dates: string[];
  entityTypes: string[];
  cells: HeatmapCell[][];
} {
  const buckets = new Map<string, number>();
  const dateSet = new Set<string>();
  const typeSet = new Set<string>();

  for (const c of changes) {
    const date = c.changedAt.slice(0, 10);
    const key = `${date}::${c.entityType}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    dateSet.add(date);
    typeSet.add(c.entityType);
  }

  const dates = Array.from(dateSet).sort();
  const entityTypes = Array.from(typeSet).sort();
  const cells: HeatmapCell[][] = entityTypes.map((et) =>
    dates.map((d) => ({
      value: buckets.get(`${d}::${et}`) ?? 0,
      date: d,
      entityType: et,
    }))
  );

  return { dates, entityTypes, cells };
}

function heatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return '#f3f4f6';
  const intensity = Math.min(1, value / max);
  const b = Math.round(235 - intensity * 150);
  return `rgb(59, ${Math.round(130 + (1 - intensity) * 60)}, ${b})`;
}

export function ChangeMetrics({ workspaceId = 'default' }: { workspaceId?: string }) {
  const [changes, setChanges] = useState<Array<{ changedAt: string; entityType: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<DayBucket[]>([]);

  useEffect(() => {
    setLoading(true);
    fetch('/api/v1/entities/changes?limit=200', {
      headers: { 'x-workspace-id': workspaceId },
    })
      .then((r) => r.json() as Promise<{ data: Array<{ changedAt: string; entityType: string }> }>)
      .then((json) => {
        setChanges(json.data ?? []);

        // Aggregate for summary buckets
        const agg = new Map<string, number>();
        for (const c of json.data ?? []) {
          const key = c.entityType;
          agg.set(key, (agg.get(key) ?? 0) + 1);
        }
        setBuckets(
          Array.from(agg.entries())
            .map(([entityType, count]) => ({ date: 'all', entityType, count }))
            .sort((a, b) => b.count - a.count)
        );
      })
      .catch(() => { /* silent */ })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  const { dates, entityTypes, cells } = buildHeatmap(changes);
  const maxVal = Math.max(0, ...cells.flat().map((c) => c.value));

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Change Frequency</h3>

      {loading && <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div>}

      {/* Summary row */}
      {buckets.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {buckets.slice(0, 8).map((b) => (
            <div key={b.entityType} style={{ padding: '6px 12px', background: '#eff6ff', borderRadius: 6, fontSize: 13 }}>
              <b>{b.entityType}</b>: {b.count}
            </div>
          ))}
        </div>
      )}

      {/* Heatmap */}
      {entityTypes.length > 0 && dates.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#6b7280' }} />
                {dates.map((d) => (
                  <th key={d} style={{ padding: '4px 6px', color: '#6b7280', fontWeight: 400, whiteSpace: 'nowrap' }}>
                    {d.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entityTypes.map((et, rowIdx) => (
                <tr key={et}>
                  <td style={{ padding: '4px 8px', color: '#374151', fontWeight: 500, whiteSpace: 'nowrap' }}>{et}</td>
                  {cells[rowIdx]!.map((cell) => (
                    <td
                      key={cell.date}
                      title={`${cell.entityType} on ${cell.date}: ${cell.value} changes`}
                      style={{
                        width: 28,
                        height: 24,
                        background: heatColor(cell.value, maxVal),
                        border: '1px solid #fff',
                        textAlign: 'center',
                        color: cell.value > maxVal * 0.6 ? '#fff' : '#374151',
                      }}
                    >
                      {cell.value > 0 ? cell.value : ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && changes.length === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 13, padding: 20, textAlign: 'center' }}>
          No change data available.
        </div>
      )}
    </div>
  );
}
