'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface StreamMetrics {
  avgDurationMs: number;
  p95DurationMs: number;
  avgTokensPerRequest: number;
  totalRequests: number;
  truncationRatePct: number;
}

interface Props {
  metrics: StreamMetrics | null;
}

export default function StreamingMetricsChart({ metrics }: Props) {
  if (!metrics) {
    return (
      <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
        No data yet
      </div>
    );
  }

  const data = [
    { name: 'Avg', value: metrics.avgDurationMs },
    { name: 'P95', value: metrics.p95DurationMs },
  ];

  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={(v: number) => `${v} ms`}
          domain={[0, Math.ceil(max * 1.2)]}
        />
        <Tooltip formatter={(v: unknown) => [`${String(v)} ms`, 'Latency']} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.value / max > 0.8 ? '#f59e0b' : '#3b82f6'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
