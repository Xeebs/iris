'use client';

import { useEffect, useState } from 'react';

interface TrendPoint {
  syncId: string;
  recordedAt: string;
  entityCount: number;
  completenessePct: number;
  schemaStabilityPct: number;
  anomalyFlags: string[];
}

interface Anomaly {
  type: string;
  severity: 'warning' | 'critical';
  description: string;
  currentValue?: number;
  baselineValue?: number;
}

interface QualityTrend {
  connectorId: string;
  windowDays: number;
  dataPoints: TrendPoint[];
  summary: {
    entityCountTrend: 'growing' | 'stable' | 'declining';
    completenessTrend: 'improving' | 'stable' | 'degrading';
    hasRecentAnomaly: boolean;
  };
}

interface AnomalyReport {
  anomalies: Anomaly[];
  detectedAt: string;
}

interface SyncQualityData {
  trend: QualityTrend;
  latestAnomalies: AnomalyReport;
}

interface SyncQualityMonitorProps {
  connectorId: string;
  workspaceId: string;
  windowDays?: number;
  apiBase?: string;
}

function trendBadge(trend: string): string {
  if (trend === 'growing' || trend === 'improving') return '↑';
  if (trend === 'declining' || trend === 'degrading') return '↓';
  return '→';
}

function trendColor(trend: string): string {
  if (trend === 'growing' || trend === 'improving') return '#16a34a';
  if (trend === 'declining' || trend === 'degrading') return '#dc2626';
  return '#64748b';
}

function severityColor(severity: 'warning' | 'critical'): string {
  return severity === 'critical' ? '#dc2626' : '#d97706';
}

export function SyncQualityMonitor({
  connectorId,
  workspaceId,
  windowDays = 30,
  apiBase = '/api/v1',
}: SyncQualityMonitorProps) {
  const [data, setData] = useState<SyncQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(
      `${apiBase}/admin/connectors/${encodeURIComponent(connectorId)}/quality?workspaceId=${encodeURIComponent(workspaceId)}&windowDays=${windowDays}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: SyncQualityData }>;
      })
      .then((body) => {
        setData(body.data);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiBase, connectorId, workspaceId, windowDays]);

  if (loading) {
    return (
      <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>
        Loading sync quality data…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '1rem', color: '#dc2626', fontSize: '0.875rem' }}>
        {error ?? 'No data available'}
      </div>
    );
  }

  const { trend, latestAnomalies } = data;
  const latest = trend.dataPoints[trend.dataPoints.length - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        <MetricCard
          label="Entity Count Trend"
          value={trendBadge(trend.summary.entityCountTrend)}
          subtitle={trend.summary.entityCountTrend}
          color={trendColor(trend.summary.entityCountTrend)}
        />
        <MetricCard
          label="Completeness"
          value={latest ? `${latest.completenessePct.toFixed(1)}%` : '—'}
          subtitle={`${trendBadge(trend.summary.completenessTrend)} ${trend.summary.completenessTrend}`}
          color={trendColor(trend.summary.completenessTrend)}
        />
        <MetricCard
          label="Schema Stability"
          value={latest ? `${latest.schemaStabilityPct.toFixed(1)}%` : '—'}
          subtitle={
            trend.summary.hasRecentAnomaly ? 'Recent anomaly detected' : 'No recent anomalies'
          }
          color={trend.summary.hasRecentAnomaly ? '#d97706' : '#16a34a'}
        />
      </div>

      {/* Anomaly alerts */}
      {latestAnomalies.anomalies.length > 0 && (
        <section>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Active Anomalies ({latestAnomalies.anomalies.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {latestAnomalies.anomalies.map((a, i) => (
              <li
                key={i}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  border: `1px solid ${severityColor(a.severity)}`,
                  backgroundColor: a.severity === 'critical' ? '#fef2f2' : '#fffbeb',
                }}
              >
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: severityColor(a.severity),
                    marginRight: '0.5rem',
                  }}
                >
                  {a.severity}
                </span>
                <span style={{ fontSize: '0.875rem' }}>{a.description}</span>
                {a.currentValue !== undefined && a.baselineValue !== undefined && (
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                    Current: {a.currentValue.toFixed(1)} · Baseline: {a.baselineValue.toFixed(1)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Data points table */}
      {trend.dataPoints.length > 0 && (
        <section>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Quality History ({windowDays}d)
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                {['Sync', 'Recorded', 'Entities', 'Completeness', 'Schema Stability', 'Flags'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem', color: '#64748b', fontWeight: 500 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...trend.dataPoints].reverse().map((p) => (
                <tr key={p.syncId} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {p.syncId.slice(0, 12)}…
                  </td>
                  <td style={{ padding: '0.5rem', color: '#64748b' }}>
                    {new Date(p.recordedAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '0.5rem' }}>{p.entityCount.toLocaleString()}</td>
                  <td style={{ padding: '0.5rem' }}>{p.completenessePct.toFixed(1)}%</td>
                  <td style={{ padding: '0.5rem' }}>{p.schemaStabilityPct.toFixed(1)}%</td>
                  <td style={{ padding: '0.5rem' }}>
                    {p.anomalyFlags.length > 0 ? (
                      <span style={{ color: '#d97706' }}>{p.anomalyFlags.join(', ')}</span>
                    ) : (
                      <span style={{ color: '#16a34a' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: string;
  subtitle: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: '1rem',
        borderRadius: '0.5rem',
        border: '1px solid #e2e8f0',
        backgroundColor: '#f8fafc',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>{subtitle}</div>
    </div>
  );
}
