'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface FeedbackRow {
  query: string;
  avgRank: number;
  clickCount: number;
  avgDwellMs: number | null;
}

interface TuningFeedbackAnalyticsProps {
  apiBase?: string;
}

/**
 * Displays aggregated click-through analytics for search relevance tuning.
 */
export function TuningFeedbackAnalytics({ apiBase = '/api/v1' }: TuningFeedbackAnalyticsProps) {
  const [data, setData] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState('30');

  useEffect(() => {
    void fetchAnalytics();
  }, [days]);

  async function fetchAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/search-tuning/analytics?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: FeedbackRow[] };
      setData(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  const chartData = data.slice(0, 15).map((r) => ({
    query: r.query.length > 20 ? `${r.query.slice(0, 20)}…` : r.query,
    clicks: r.clickCount,
    avgRank: parseFloat(r.avgRank.toFixed(1)),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
          Click-through data from user search interactions.
        </p>
        <select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          style={{ padding: '0.375rem 0.625rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading analytics…</p>}

      {!loading && data.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
          No feedback data yet. Users clicking search results will generate signals here.
        </p>
      )}

      {!loading && data.length > 0 && (
        <>
          <div>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>
              Top Queries by Click Count
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="query" tick={{ fontSize: 10, fill: '#64748b' }} angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                <Bar dataKey="clicks" fill="#2563eb" radius={[3, 3, 0, 0]} name="Clicks" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  {['Query', 'Clicks', 'Avg Rank', 'Avg Dwell'].map((h) => (
                    <th key={h} style={{ padding: '0.625rem 1rem', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.625rem 1rem', color: '#111827', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.query}
                    </td>
                    <td style={{ padding: '0.625rem 1rem', color: '#374151', fontWeight: 600 }}>{row.clickCount}</td>
                    <td style={{ padding: '0.625rem 1rem', color: row.avgRank > 5 ? '#d97706' : '#16a34a' }}>
                      {row.avgRank.toFixed(1)}
                    </td>
                    <td style={{ padding: '0.625rem 1rem', color: '#64748b' }}>
                      {row.avgDwellMs !== null ? `${Math.round(row.avgDwellMs / 1000)}s` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
