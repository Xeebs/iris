'use client';

type MetricCell = {
  connectorId: string;
  entityType: string;
  throughputPerSec: number;
  memoryPeakMb: number;
  durationMs: number;
  errorRate: number;
} | null;

type PerformanceMatrixProps = {
  matrix: Record<string, Record<string, MetricCell>>;
  entityTypes: string[];
  connectorIds: string[];
  metric?: 'throughput' | 'memory' | 'latency';
};

function getHeatColor(value: number, min: number, max: number, higher = true): string {
  if (max === min) return '#f3f4f6';
  const normalized = (value - min) / (max - min);
  const intensity = higher ? normalized : 1 - normalized;
  const r = Math.round(239 - (239 - 34) * intensity);
  const g = Math.round(68 + (197 - 68) * intensity);
  const b = Math.round(68 + (94 - 68) * intensity);
  return `rgb(${r}, ${g}, ${b})`;
}

export function PerformanceMatrix({ matrix, entityTypes, connectorIds, metric = 'throughput' }: PerformanceMatrixProps) {
  function getValue(cell: MetricCell): number {
    if (!cell) return 0;
    if (metric === 'throughput') return cell.throughputPerSec;
    if (metric === 'memory') return cell.memoryPeakMb;
    return cell.durationMs;
  }

  const allValues = entityTypes.flatMap((et) =>
    connectorIds.map((c) => getValue(matrix[et]?.[c] ?? null))
  ).filter((v) => v > 0);

  const min = Math.min(...allValues, 0);
  const max = Math.max(...allValues, 1);
  const higherIsBetter = metric === 'throughput';

  return (
    <div style={{ fontFamily: 'sans-serif', overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: 400 }}>
        <thead>
          <tr>
            <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb' }}>
              Entity Type
            </th>
            {connectorIds.map((c) => (
              <th key={c} style={{ padding: '0.4rem 0.75rem', textAlign: 'center', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entityTypes.map((et) => (
            <tr key={et} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.4rem 0.75rem', color: '#374151', fontWeight: 500, whiteSpace: 'nowrap' }}>{et}</td>
              {connectorIds.map((c) => {
                const cell = matrix[et]?.[c] ?? null;
                const val = getValue(cell);
                const color = cell ? getHeatColor(val, min, max, higherIsBetter) : '#f9fafb';
                return (
                  <td
                    key={c}
                    title={cell ? `Throughput: ${cell.throughputPerSec}/s | Memory: ${cell.memoryPeakMb}MB | Latency: ${cell.durationMs}ms | Error: ${(cell.errorRate * 100).toFixed(1)}%` : 'No data'}
                    style={{
                      padding: '0.4rem 0.75rem',
                      textAlign: 'center',
                      background: color,
                      color: val / max > 0.5 ? '#fff' : '#374151',
                      fontSize: '0.8125rem',
                      cursor: 'default',
                    }}
                  >
                    {cell ? (
                      metric === 'throughput' ? `${val.toFixed(0)}/s`
                        : metric === 'memory' ? `${val.toFixed(1)}MB`
                        : `${val}ms`
                    ) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
