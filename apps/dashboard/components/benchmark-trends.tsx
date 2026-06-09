'use client';

type BenchmarkPoint = {
  runAt: string;
  throughputPerSec: number;
  memoryPeakMb: number;
  durationMs: number;
};

type BenchmarkTrendsProps = {
  connectorId: string;
  entityType: string;
  points: BenchmarkPoint[];
  metric?: 'throughput' | 'memory' | 'latency';
};

const CHART_H = 100;
const CHART_W = 420;
const PADDING = { top: 8, right: 16, bottom: 24, left: 40 };

export function BenchmarkTrends({ connectorId, entityType, points, metric = 'throughput' }: BenchmarkTrendsProps) {
  if (points.length < 2) {
    return (
      <div style={{ fontFamily: 'sans-serif', color: '#9ca3af', fontSize: '0.875rem', padding: '1rem' }}>
        Not enough data for trend chart — run at least 2 benchmarks.
      </div>
    );
  }

  function getValue(p: BenchmarkPoint): number {
    if (metric === 'throughput') return p.throughputPerSec;
    if (metric === 'memory') return p.memoryPeakMb;
    return p.durationMs;
  }

  const values = points.map(getValue);
  const maxV = Math.max(...values);
  const minV = Math.min(...values);
  const range = maxV - minV || 1;

  const innerW = CHART_W - PADDING.left - PADDING.right;
  const innerH = CHART_H - PADDING.top - PADDING.bottom;

  const toX = (i: number) => PADDING.left + (i / (points.length - 1)) * innerW;
  const toY = (v: number) => PADDING.top + innerH - ((v - minV) / range) * innerH;

  const pathData = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(getValue(p)).toFixed(1)}`)
    .join(' ');

  const latestVal = getValue(points[points.length - 1]!);
  const prevVal = points.length > 1 ? getValue(points[points.length - 2]!) : latestVal;
  const trend = latestVal > prevVal * 1.05 ? '↑' : latestVal < prevVal * 0.95 ? '↓' : '→';
  const trendColor = metric === 'throughput'
    ? (trend === '↑' ? '#22c55e' : trend === '↓' ? '#ef4444' : '#6b7280')
    : (trend === '↑' ? '#ef4444' : trend === '↓' ? '#22c55e' : '#6b7280');

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.8125rem' }}>
        <span style={{ fontWeight: 600, color: '#374151' }}>{connectorId} / {entityType}</span>
        <span style={{ color: trendColor, fontWeight: 600 }}>
          {latestVal.toFixed(metric === 'throughput' ? 0 : 1)}{metric === 'throughput' ? '/s' : metric === 'memory' ? 'MB' : 'ms'} {trend}
        </span>
      </div>
      <svg width={CHART_W} height={CHART_H} style={{ display: 'block' }}>
        {/* Y axis */}
        <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={PADDING.top + innerH} stroke="#e5e7eb" />
        {/* X axis */}
        <line x1={PADDING.left} y1={PADDING.top + innerH} x2={PADDING.left + innerW} y2={PADDING.top + innerH} stroke="#e5e7eb" />

        {/* Y labels */}
        <text x={PADDING.left - 4} y={PADDING.top + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{maxV.toFixed(0)}</text>
        <text x={PADDING.left - 4} y={PADDING.top + innerH} textAnchor="end" fontSize={9} fill="#9ca3af">{minV.toFixed(0)}</text>

        {/* Data area fill */}
        <path
          d={`${pathData} L${toX(points.length - 1).toFixed(1)},${(PADDING.top + innerH).toFixed(1)} L${PADDING.left.toFixed(1)},${(PADDING.top + innerH).toFixed(1)} Z`}
          fill="#3b82f6"
          fillOpacity={0.08}
        />

        {/* Data line */}
        <path d={pathData} fill="none" stroke="#3b82f6" strokeWidth={2} />

        {/* Data points */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(getValue(p))}
            r={3}
            fill="#3b82f6"
          >
            <title>{new Date(p.runAt).toLocaleString()}: {getValue(p).toFixed(1)}</title>
          </circle>
        ))}

        {/* X labels */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((i) => (
          <text key={i} x={toX(i)} y={PADDING.top + innerH + 14} textAnchor="middle" fontSize={9} fill="#9ca3af">
            {new Date(points[i]!.runAt).toLocaleDateString()}
          </text>
        ))}
      </svg>
    </div>
  );
}
