'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface CostSlice {
  name: string;
  value: number;
  pct: number;
}

interface CostBreakdownChartProps {
  data: CostSlice[];
  title: string;
}

const COLORS = ['#2563eb', '#7c3aed', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#9333ea'];

/**
 * Pie chart showing token cost breakdown (by connector or entity type).
 */
export function CostBreakdownChart({ data, title }: CostBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No cost data available.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '1rem' }}>{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            outerRadius={90}
            dataKey="value"
            nameKey="name"
            label={({ name, pct }: { name: string; pct: number }) => `${name} (${pct.toFixed(1)}%)`}
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
            formatter={(value: number) => [`${value.toLocaleString()} tokens`]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
