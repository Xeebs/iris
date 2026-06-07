'use client';

import { useState } from 'react';
import { BenchmarkComparisonChart } from './benchmark-comparison-chart.js';

interface WorkspaceMetrics {
  entityCount: number;
  queryCount: number;
  avgContextSizeTokens: number;
  tokenSavingsRatio: number;
  cacheHitRate: number;
  snapshotAt: string;
}

interface PercentileResult {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

interface PeerComparison {
  metric: string;
  workspaceValue: number;
  peerPercentiles: PercentileResult;
  percentileRank: number;
}

interface BenchmarkReport {
  workspaceId: string;
  metrics: WorkspaceMetrics;
  peerComparisons: PeerComparison[];
  peerCount: number;
}

interface BenchmarkingSettings {
  workspaceId: string;
  benchmarkingEnabled: boolean;
  industry: string | null;
  companySize: string | null;
}

type Props = {
  workspaceId: string;
  initialSettings: BenchmarkingSettings;
  initialReport?: BenchmarkReport | null;
};

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function BenchmarkingCard({ workspaceId, initialSettings, initialReport }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [report, setReport] = useState<BenchmarkReport | null>(initialReport ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggleOptIn(enable: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/workspace/benchmarks/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, benchmarkingEnabled: enable }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: BenchmarkingSettings };
      setSettings(body.data);

      if (enable) {
        await refreshSnapshot();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setLoading(false);
    }
  }

  async function refreshSnapshot() {
    setLoading(true);
    setError(null);
    try {
      await fetch(`/api/v1/workspace/benchmark-snapshot?workspaceId=${workspaceId}`);
      const compRes = await fetch(`/api/v1/workspace/benchmarks/peer-comparison?workspaceId=${workspaceId}`);
      if (compRes.ok) {
        const body = await compRes.json() as { data: BenchmarkReport };
        setReport(body.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setLoading(false);
    }
  }

  const m = report?.metrics;

  return (
    <section className="rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Peer Benchmarks</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Compare your workspace against anonymised industry peers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refreshSnapshot}
            disabled={loading}
            className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-40"
          >
            Refresh
          </button>
          <label className="flex items-center gap-1.5 cursor-pointer" title="Share anonymised metrics with the peer pool">
            <input
              type="checkbox"
              className="rounded"
              checked={settings.benchmarkingEnabled}
              disabled={loading}
              onChange={(e) => handleToggleOptIn(e.target.checked)}
            />
            <span className="text-xs text-gray-600">Share data</span>
          </label>
        </div>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 text-red-600 text-xs rounded">
          {error}
        </div>
      )}

      {m ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <MetricTile
              label="Entity Count"
              value={m.entityCount.toLocaleString()}
              sub="indexed entities"
            />
            <MetricTile
              label="Token Savings"
              value={`${(m.tokenSavingsRatio * 100).toFixed(1)}%`}
              sub="compression savings"
            />
            <MetricTile
              label="Cache Hit Rate"
              value={`${(m.cacheHitRate * 100).toFixed(1)}%`}
              sub="semantic cache"
            />
          </div>

          {report && report.peerCount > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                vs. {report.peerCount} peer workspaces
              </h3>
              <BenchmarkComparisonChart comparisons={report.peerComparisons} />
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">
              {settings.benchmarkingEnabled
                ? 'No peer data in your segment yet. Check back as more workspaces contribute.'
                : 'Enable data sharing above to see peer comparisons.'}
            </p>
          )}
        </>
      ) : (
        <div className="text-center py-8">
          {loading ? (
            <p className="text-sm text-gray-400">Loading metrics…</p>
          ) : (
            <div>
              <p className="text-sm text-gray-400 mb-3">No snapshot yet.</p>
              <button
                onClick={refreshSnapshot}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Collect Metrics
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
