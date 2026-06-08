'use client';

import { useState, useEffect, useCallback } from 'react';

type AnomalySeverity = 'low' | 'medium' | 'high';

type MetricAnomaly = {
  anomalyId: string;
  metricId: string;
  anomalyDate: string;
  observedValue: number;
  expectedValue: number;
  zScore: number;
  severity: AnomalySeverity;
  detectedAt: string;
  acknowledgedAt: string | null;
  notes: string | null;
};

type ForecastPoint = {
  date: string;
  forecastedValue: number;
  trend: 'up' | 'down' | 'stable';
};

const SEVERITY_COLOR: Record<AnomalySeverity, string> = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#eab308',
};

const SEVERITY_BG: Record<AnomalySeverity, string> = {
  high: '#fef2f2',
  medium: '#fff7ed',
  low: '#fefce8',
};

type AnomalyTimelineProps = {
  metricId: string;
  apiBase?: string;
};

export function AnomalyTimeline({ metricId, apiBase = '/api/v1' }: AnomalyTimelineProps) {
  const [anomalies, setAnomalies] = useState<MetricAnomaly[]>([]);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showAcked, setShowAcked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAnomalies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/metrics/${encodeURIComponent(metricId)}/anomalies?includeAcknowledged=${showAcked}`
      );
      const json = await res.json() as { data?: MetricAnomaly[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Request failed');
      setAnomalies(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load anomalies');
    } finally {
      setLoading(false);
    }
  }, [metricId, apiBase, showAcked]);

  const loadForecast = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/metrics/${encodeURIComponent(metricId)}/forecast?daysAhead=7`);
      const json = await res.json() as { data?: ForecastPoint[] };
      if (res.ok) setForecast(json.data ?? []);
    } catch {
      // forecast is optional; failure is non-critical
    }
  }, [metricId, apiBase]);

  useEffect(() => {
    void loadAnomalies();
    void loadForecast();
  }, [loadAnomalies, loadForecast]);

  const runDetection = async () => {
    setDetecting(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/metrics/${encodeURIComponent(metricId)}/anomalies/detect`,
        { method: 'POST' }
      );
      const json = await res.json() as { data?: MetricAnomaly[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Detection failed');
      await loadAnomalies();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const acknowledge = async (anomalyId: string) => {
    try {
      await fetch(
        `${apiBase}/metrics/${encodeURIComponent(metricId)}/anomalies/${anomalyId}/acknowledge`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      );
      await loadAnomalies();
    } catch {
      setError('Failed to acknowledge');
    }
  };

  const trendIcon = (t: ForecastPoint['trend']) => (t === 'up' ? '↑' : t === 'down' ? '↓' : '→');

  const unacked = anomalies.filter(a => !a.acknowledgedAt);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 800 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Anomaly Timeline</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{metricId}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showAcked}
              onChange={e => setShowAcked(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            Show acknowledged
          </label>
          <button
            onClick={() => void runDetection()}
            disabled={detecting}
            style={{
              padding: '6px 14px',
              background: detecting ? '#9ca3af' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              cursor: detecting ? 'not-allowed' : 'pointer',
            }}
          >
            {detecting ? 'Detecting…' : 'Run Detection'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Summary bar */}
      {!loading && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          {(['high', 'medium', 'low'] as AnomalySeverity[]).map(sev => {
            const count = unacked.filter(a => a.severity === sev).length;
            return (
              <div
                key={sev}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: SEVERITY_BG[sev],
                  borderRadius: 8,
                  borderLeft: `4px solid ${SEVERITY_COLOR[sev]}`,
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700, color: SEVERITY_COLOR[sev] }}>{count}</div>
                <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'capitalize' }}>{sev} severity</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Anomaly list */}
      {loading ? (
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</p>
      ) : anomalies.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>No anomalies found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {anomalies.map(a => (
            <div
              key={a.anomalyId}
              style={{
                padding: '10px 14px',
                background: a.acknowledgedAt ? '#f9fafb' : SEVERITY_BG[a.severity],
                border: `1px solid ${a.acknowledgedAt ? '#e5e7eb' : SEVERITY_COLOR[a.severity]}`,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                opacity: a.acknowledgedAt ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: SEVERITY_COLOR[a.severity],
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {new Date(a.anomalyDate).toLocaleDateString()} — {a.severity.toUpperCase()}
                  {a.acknowledgedAt && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                      ✓ acknowledged
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                  Observed: <strong>{a.observedValue}</strong> · Expected: {a.expectedValue.toFixed(2)} · Z-score: {a.zScore.toFixed(2)}σ
                </div>
              </div>
              {!a.acknowledgedAt && (
                <button
                  onClick={() => void acknowledge(a.anomalyId)}
                  style={{
                    padding: '4px 10px',
                    background: '#fff',
                    border: `1px solid ${SEVERITY_COLOR[a.severity]}`,
                    borderRadius: 5,
                    color: SEVERITY_COLOR[a.severity],
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Acknowledge
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 7-day forecast */}
      {forecast.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: '#374151' }}>7-Day Forecast</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {forecast.map((p, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  background: '#f8faff',
                  borderRadius: 6,
                  border: '1px solid #dbeafe',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 10, color: '#9ca3af' }}>
                  {new Date(p.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1e40af', marginTop: 2 }}>
                  {p.forecastedValue}
                </div>
                <div style={{ fontSize: 12 }}>{trendIcon(p.trend)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
