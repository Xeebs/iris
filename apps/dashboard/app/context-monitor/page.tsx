'use client';

import { useEffect, useState, useCallback } from 'react';

import StreamingPreviewPanel from '../../components/streaming-preview-panel';
import StreamingMetricsChart from '../../components/streaming-metrics-chart';

interface StreamMetrics {
  avgDurationMs: number;
  p95DurationMs: number;
  avgTokensPerRequest: number;
  totalRequests: number;
  truncationRatePct: number;
}

export default function ContextMonitorPage() {
  const [metrics, setMetrics] = useState<StreamMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/context/stream/metrics');
      if (!res.ok) throw new Error(`Failed to load metrics (${res.status})`);
      const json = (await res.json()) as { data: StreamMetrics };
      setMetrics(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMetrics();
    const interval = setInterval(() => void fetchMetrics(), 30_000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Context Stream Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time view of streaming context API activity
          </p>
        </div>
        <button
          onClick={() => void fetchMetrics()}
          disabled={loading}
          className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetricCard label="Avg Duration" value={`${metrics.avgDurationMs} ms`} />
          <MetricCard label="P95 Duration" value={`${metrics.p95DurationMs} ms`} />
          <MetricCard label="Avg Tokens" value={metrics.avgTokensPerRequest.toString()} />
          <MetricCard label="Total Requests (24h)" value={metrics.totalRequests.toString()} />
          <MetricCard
            label="Truncation Rate"
            value={`${metrics.truncationRatePct.toFixed(1)}%`}
            warn={metrics.truncationRatePct > 20}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-base font-semibold mb-4">Latency Distribution (24h)</h2>
          <StreamingMetricsChart metrics={metrics} />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-base font-semibold mb-4">Live Preview</h2>
          <StreamingPreviewPanel />
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${warn ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
    >
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${warn ? 'text-amber-700' : 'text-gray-900'}`}>
        {value}
      </p>
    </div>
  );
}
