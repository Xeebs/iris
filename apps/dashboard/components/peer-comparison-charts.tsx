'use client';

type PercentileResult = {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

type BenchmarkEntry = {
  metricType: string;
  yourValue: number;
  percentileRank: number;
  peerPercentiles: PercentileResult;
  unit?: string;
};

type Props = {
  benchmarks: BenchmarkEntry[];
};

function PercentileBar({ value, percentiles, percentileRank }: {
  value: number;
  percentiles: PercentileResult;
  percentileRank: number;
}) {
  const markers = [
    { label: 'P25', value: percentiles.p25 },
    { label: 'P50', value: percentiles.p50 },
    { label: 'P75', value: percentiles.p75 },
    { label: 'P90', value: percentiles.p90 },
  ];
  const max = Math.max(...markers.map((m) => m.value), value) * 1.1;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: 'relative', height: 12, background: '#f3f4f6', borderRadius: 6, overflow: 'visible' }}>
        {/* Gradient fill up to P75 */}
        <div style={{ height: '100%', width: `${(percentiles.p75 / max) * 100}%`, background: 'linear-gradient(to right, #dcfce7, #fef9c3)', borderRadius: 6 }} />
        {/* Peer markers */}
        {markers.map((m) => (
          <div
            key={m.label}
            style={{
              position: 'absolute', top: -2, left: `${(m.value / max) * 100}%`,
              width: 2, height: 16, background: '#9ca3af',
              transform: 'translateX(-50%)',
            }}
          />
        ))}
        {/* Your value */}
        <div
          style={{
            position: 'absolute', top: -4, left: `${(value / max) * 100}%`,
            width: 4, height: 20, background: '#6366f1',
            borderRadius: 2, transform: 'translateX(-50%)',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: '#9ca3af' }}>
        {markers.map((m) => (
          <span key={m.label}>{m.label}: {m.value.toLocaleString()}</span>
        ))}
      </div>
      <div style={{ marginTop: 4, fontSize: 11 }}>
        <span style={{ color: '#6366f1', fontWeight: 600 }}>You: {value.toLocaleString()}</span>
        <span style={{ color: '#6b7280', marginLeft: 8 }}>
          at {Math.round(percentileRank)}th percentile among peers
        </span>
      </div>
    </div>
  );
}

/**
 * Renders peer comparison charts showing workspace metrics vs. industry benchmarks.
 *
 * @param benchmarks - Array of benchmark entries with your value and peer percentiles
 */
export function PeerComparisonCharts({ benchmarks }: Props) {
  if (benchmarks.length === 0) {
    return (
      <div style={{ padding: 24, color: '#6b7280', textAlign: 'center', fontSize: 13 }}>
        No benchmark data yet. Opt in and wait for the next metrics collection cycle.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {benchmarks.map((b) => (
        <div key={b.metricType} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>
              {b.metricType.replace(/_/g, ' ')}
            </div>
            <span
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 9999, fontWeight: 600,
                background: b.percentileRank >= 75 ? '#dcfce7' : b.percentileRank >= 50 ? '#fef9c3' : '#fee2e2',
                color: b.percentileRank >= 75 ? '#15803d' : b.percentileRank >= 50 ? '#92400e' : '#b91c1c',
              }}
            >
              {Math.round(b.percentileRank)}th percentile
            </span>
          </div>
          <PercentileBar value={b.yourValue} percentiles={b.peerPercentiles} percentileRank={b.percentileRank} />
        </div>
      ))}
    </div>
  );
}
