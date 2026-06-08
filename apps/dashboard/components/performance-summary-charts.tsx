'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

interface LatencyBucket {
  bucket: string;
  count: number;
}

interface ThroughputPoint {
  date: string;
  requests: number;
  cache_hits: number;
}

interface PerformanceSummaryChartsProps {
  latencyBuckets?: LatencyBucket[];
  throughputSeries?: ThroughputPoint[];
}

const DEFAULT_LATENCY: LatencyBucket[] = [
  { bucket: '<50ms', count: 0 },
  { bucket: '50–100ms', count: 0 },
  { bucket: '100–250ms', count: 0 },
  { bucket: '250–500ms', count: 0 },
  { bucket: '>500ms', count: 0 },
];

export function LatencyDistributionChart({ data = DEFAULT_LATENCY }: { data?: LatencyBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
          formatter={(value: number) => [value.toLocaleString(), 'Requests']}
        />
        <Bar dataKey="count" fill="#2563eb" radius={[3, 3, 0, 0]} name="Requests" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RequestThroughputChart({ data = [] }: { data?: ThroughputPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="requests" fill="#2563eb" radius={[3, 3, 0, 0]} name="Total Requests" />
        <Bar dataKey="cache_hits" fill="#16a34a" radius={[3, 3, 0, 0]} name="Cache Hits" />
      </BarChart>
    </ResponsiveContainer>
  );
}
