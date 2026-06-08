'use client';

import { useState, useEffect, useCallback } from 'react';

type HealthAction = 'reindex_recommended' | 'investigate_outliers' | 'ok';

type VectorHealthReport = {
  workspaceId: string;
  overallHealthScore: number;
  driftScore: number;
  consistencyScore: number;
  outlierCount: number;
  qualityIssuesCount: number;
  recommendedActions: HealthAction[];
  sampleSize: number;
  checkedAt: string;
};

type VectorHealthMonitorProps = {
  workspaceId: string;
};

const ACTION_LABELS: Record<HealthAction, string> = {
  reindex_recommended: 'Re-index Recommended',
  investigate_outliers: 'Investigate Outliers',
  ok: 'Healthy',
};

const ACTION_COLORS: Record<HealthAction, string> = {
  reindex_recommended: 'bg-amber-100 text-amber-700',
  investigate_outliers: 'bg-orange-100 text-orange-700',
  ok: 'bg-green-100 text-green-700',
};

function ScoreGauge({ score }: { score: number }): React.JSX.Element {
  const color = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex flex-col items-center">
      <span className={`text-4xl font-bold tabular-nums ${color}`}>{score}</span>
      <span className="text-xs text-gray-500">/ 100</span>
    </div>
  );
}

function MetricBar({ label, value, good = true }: { label: string; value: number; good?: boolean }): React.JSX.Element {
  const pct = Math.round(value * 100);
  const barColor = good
    ? pct >= 95 ? 'bg-green-500' : pct >= 80 ? 'bg-amber-500' : 'bg-red-500'
    : pct <= 5 ? 'bg-green-500' : pct <= 15 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span className="tabular-nums font-medium">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function VectorHealthMonitor({ workspaceId }: VectorHealthMonitorProps): React.JSX.Element {
  const [latest, setLatest] = useState<VectorHealthReport | null>(null);
  const [history, setHistory] = useState<VectorHealthReport[]>([]);
  const [running, setRunning] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/vector-health?workspaceId=${encodeURIComponent(workspaceId)}`);
      if (res.ok) {
        const body = await res.json() as { data: { latest: VectorHealthReport | null; history: VectorHealthReport[] } };
        setLatest(body.data.latest);
        setHistory(body.data.history);
      }
    } catch {
      // non-fatal
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function handleRunCheck(): Promise<void> {
    setRunning(true);
    try {
      const res = await fetch('/api/v1/admin/vector-health/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (res.ok) {
        setNotification('Health check completed');
        await load();
      } else {
        setNotification('Health check failed');
      }
    } finally {
      setRunning(false);
      setTimeout(() => setNotification(null), 4000);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Vector Index Health</h3>
        <button
          type="button"
          disabled={running}
          onClick={() => void handleRunCheck()}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run Health Check'}
        </button>
      </div>

      {notification && (
        <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{notification}</div>
      )}

      {!latest ? (
        <p className="mt-4 text-sm text-gray-500">No health checks run yet. Click to start the first check.</p>
      ) : (
        <>
          <div className="mt-5 flex items-start gap-8">
            <div className="flex flex-col items-center gap-1">
              <p className="text-xs font-medium text-gray-500">Overall Score</p>
              <ScoreGauge score={latest.overallHealthScore} />
            </div>

            <div className="flex-1 space-y-3">
              <MetricBar label="Consistency" value={latest.consistencyScore} good />
              <MetricBar label="Drift (lower is better)" value={latest.driftScore} good={false} />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-gray-500">Status</p>
              {latest.recommendedActions.map((action) => (
                <span
                  key={action}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ACTION_COLORS[action]}`}
                >
                  {ACTION_LABELS[action]}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-lg font-bold text-gray-900">{latest.outlierCount}</p>
              <p className="text-xs text-gray-500">Outliers</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-lg font-bold text-gray-900">{latest.qualityIssuesCount}</p>
              <p className="text-xs text-gray-500">Quality Issues</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-lg font-bold text-gray-900">{latest.sampleSize.toLocaleString()}</p>
              <p className="text-xs text-gray-500">Sample Size</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-400">
            Last checked: {new Date(latest.checkedAt).toLocaleString()}
          </p>
        </>
      )}

      {history.length > 1 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-gray-500">Trend (last {history.length} checks)</p>
          <div className="flex items-end gap-1">
            {history.slice(0, 20).reverse().map((h, i) => {
              const height = Math.max(4, (h.overallHealthScore / 100) * 48);
              const color = h.overallHealthScore >= 80 ? 'bg-green-400' : h.overallHealthScore >= 60 ? 'bg-amber-400' : 'bg-red-400';
              return (
                <div
                  key={i}
                  title={`${h.overallHealthScore} — ${new Date(h.checkedAt).toLocaleDateString()}`}
                  style={{ height: `${height}px` }}
                  className={`w-3 flex-shrink-0 rounded-t ${color} opacity-80 hover:opacity-100`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
