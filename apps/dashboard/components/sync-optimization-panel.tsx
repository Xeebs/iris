'use client';

import { useState, useCallback } from 'react';

type LatencyStats = {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgEntityThroughput: number;
  avgTokenThroughput: number;
  totalSyncs: number;
  failureRate: number;
};

type BatchSizeRecommendation = {
  recommendedBatchSize: number;
  currentAvgBatchSize: number;
  predictedDurationMs: number;
  targetDurationMs: number;
  confidence: 'high' | 'medium' | 'low';
};

type ParallelismRecommendation = {
  recommendedParallelism: number;
  rateLimitedFraction: number;
  cpuCount: number;
};

type OptimizationReport = {
  connectorId: string;
  latencyStats: LatencyStats;
  batchSizeRecommendation: BatchSizeRecommendation;
  parallelismRecommendation: ParallelismRecommendation;
  bottleneck: 'api_rate_limit' | 'processing_time' | 'memory' | 'unknown';
  estimatedThroughputGain: number;
  generatedAt: string;
};

type SyncOptimizationPanelProps = {
  connectorId: string;
  apiBase?: string;
};

const BOTTLENECK_LABEL: Record<string, string> = {
  api_rate_limit: 'API Rate Limit',
  processing_time: 'Processing Time',
  memory: 'Memory',
  unknown: 'Unknown',
};

const CONFIDENCE_COLOR = {
  high: '#16a34a',
  medium: '#d97706',
  low: '#9ca3af',
};

function MetricCard({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div style={{ padding: '12px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>
        {value}{unit && <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginLeft: 3 }}>{unit}</span>}
      </div>
    </div>
  );
}

/**
 * Dashboard panel for sync performance metrics and optimization recommendations.
 * Shows latency stats, throughput charts, and batch/parallelism recommendations.
 */
export function SyncOptimizationPanel({ connectorId, apiBase = '/api/v1' }: SyncOptimizationPanelProps) {
  const [stats, setStats] = useState<LatencyStats | null>(null);
  const [report, setReport] = useState<OptimizationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/connectors/${encodeURIComponent(connectorId)}/sync-metrics`);
      const json = await res.json() as { data?: LatencyStats; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load metrics');
      setStats(json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [connectorId, apiBase]);

  const runOptimization = async () => {
    setOptimizing(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/connectors/${encodeURIComponent(connectorId)}/optimize`, {
        method: 'POST',
      });
      const json = await res.json() as { data?: OptimizationReport; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Optimization failed');
      setReport(json.data ?? null);
      if (json.data) setStats(json.data.latencyStats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  const formatMs = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  const formatThroughput = (t: number) => `${t.toFixed(1)}/s`;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 860 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Sync Performance</h3>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280' }}>{connectorId}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => void loadStats()}
            disabled={loading}
            style={{
              padding: '7px 14px', background: '#fff', border: '1px solid #d1d5db',
              borderRadius: 6, fontSize: 13, cursor: 'pointer',
            }}
          >
            {loading ? 'Loading…' : 'Refresh Stats'}
          </button>
          <button
            onClick={() => void runOptimization()}
            disabled={optimizing}
            style={{
              padding: '7px 16px',
              background: optimizing ? '#9ca3af' : '#2563eb',
              color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 13,
              cursor: optimizing ? 'not-allowed' : 'pointer',
            }}
          >
            {optimizing ? 'Analyzing…' : 'Run Optimization'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Latency stats */}
      {stats && (
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1 }}>
            Latency (last 30 days)
          </h4>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <MetricCard label="P50" value={formatMs(stats.p50Ms)} />
            <MetricCard label="P95" value={formatMs(stats.p95Ms)} />
            <MetricCard label="P99" value={formatMs(stats.p99Ms)} />
            <MetricCard label="Avg Entity/s" value={formatThroughput(stats.avgEntityThroughput)} />
            <MetricCard label="Total Syncs" value={stats.totalSyncs} />
            <MetricCard label="Failure Rate" value={`${(stats.failureRate * 100).toFixed(1)}%`} />
          </div>
        </div>
      )}

      {/* Optimization report */}
      {report && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Optimization Recommendations</h4>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#9ca3af' }}>
                Generated {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Bottleneck</div>
              <div style={{ fontWeight: 700, color: '#dc2626' }}>{BOTTLENECK_LABEL[report.bottleneck] ?? report.bottleneck}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {/* Batch size */}
            <div style={{ padding: '14px 16px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Recommended Batch Size</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: '#1d4ed8' }}>
                  {report.batchSizeRecommendation.recommendedBatchSize}
                </span>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  (currently {report.batchSizeRecommendation.currentAvgBatchSize})
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                <span
                  style={{
                    color: CONFIDENCE_COLOR[report.batchSizeRecommendation.confidence],
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  {report.batchSizeRecommendation.confidence}
                </span>
                {' '}confidence · target {formatMs(report.batchSizeRecommendation.targetDurationMs)}/batch
              </div>
            </div>

            {/* Parallelism */}
            <div style={{ padding: '14px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Recommended Parallelism</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: '#16a34a' }}>
                  {report.parallelismRecommendation.recommendedParallelism}
                </span>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  of {report.parallelismRecommendation.cpuCount} CPUs
                </span>
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                {(report.parallelismRecommendation.rateLimitedFraction * 100).toFixed(0)}% syncs hit rate limit
              </div>
            </div>
          </div>

          {report.estimatedThroughputGain > 0 && (
            <div style={{
              padding: '10px 14px',
              background: '#fefce8',
              borderRadius: 6,
              border: '1px solid #fef08a',
              fontSize: 13,
              color: '#854d0e',
            }}>
              Estimated throughput improvement: <strong>+{(report.estimatedThroughputGain * 100).toFixed(0)}%</strong>
            </div>
          )}
        </div>
      )}

      {!stats && !loading && (
        <div style={{ padding: 40, textAlign: 'center', border: '2px dashed #e5e7eb', borderRadius: 10, color: '#9ca3af', fontSize: 14 }}>
          Click "Refresh Stats" to load performance data or "Run Optimization" to get recommendations.
        </div>
      )}
    </div>
  );
}
