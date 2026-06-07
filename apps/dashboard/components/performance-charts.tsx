'use client';

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface SyncRecord {
  startedAt: string;
  totalDurationMs: number | null;
  entitiesSynced: number;
  errorCount: number;
  status: string;
}

interface SyncThroughputChartProps {
  data: SyncRecord[];
}

export function SyncThroughputChart({ data }: SyncThroughputChartProps) {
  const chartData = data
    .filter((r) => r.status === 'completed' && r.totalDurationMs != null)
    .map((r) => ({
      date: new Date(r.startedAt).toLocaleDateString(),
      durationSec: Math.round((r.totalDurationMs ?? 0) / 1000),
      entities: r.entitiesSynced,
    }))
    .reverse();

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: 'Duration (s)', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 11 } }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} label={{ value: 'Entities', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 11 } }} />
        <Tooltip />
        <Legend />
        <Line yAxisId="left" type="monotone" dataKey="durationSec" stroke="#6366f1" name="Duration (s)" dot={false} />
        <Line yAxisId="right" type="monotone" dataKey="entities" stroke="#22c55e" name="Entities synced" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface PercentileData {
  p50DurationMs: number | null;
  p90DurationMs: number | null;
  p99DurationMs: number | null;
}

interface SyncDurationDistributionProps {
  data: PercentileData | null;
}

export function SyncDurationDistribution({ data }: SyncDurationDistributionProps) {
  if (!data) {
    return <p className="text-muted-foreground text-sm">No performance data available.</p>;
  }

  const chartData = [
    { label: 'p50', value: data.p50DurationMs != null ? Math.round(data.p50DurationMs / 1000) : 0 },
    { label: 'p90', value: data.p90DurationMs != null ? Math.round(data.p90DurationMs / 1000) : 0 },
    { label: 'p99', value: data.p99DurationMs != null ? Math.round(data.p99DurationMs / 1000) : 0 },
  ];

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} label={{ value: 'Seconds', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
        <Tooltip formatter={(v) => `${v as number}s`} />
        <Bar dataKey="value" fill="#6366f1" name="Duration" />
      </BarChart>
    </ResponsiveContainer>
  );
}
