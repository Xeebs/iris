'use client';

import { useState } from 'react';

type RebuildResult = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'dry_run';
  entityTypeFilter?: string;
  isDryRun: boolean;
  estimatedEntities?: number;
  reindexedCount?: number;
  startedAt: string;
  completedAt?: string;
};

interface RebuildProgressPanelProps {
  workspaceId: string;
}

/**
 * Triggers index rebuilds with optional dry-run mode and shows progress/results.
 */
export function RebuildProgressPanel({ workspaceId }: RebuildProgressPanelProps) {
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<RebuildResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RebuildResult[]>([]);

  async function triggerRebuild() {
    if (!workspaceId) {
      setError('workspaceId is required');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/v1/index-repair/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          dryRun,
          entityTypeFilter: entityTypeFilter.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { data: RebuildResult };
      setResult(json.data);
      setHistory(prev => [json.data, ...prev].slice(0, 10));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const progressPct =
    result && result.estimatedEntities && result.reindexedCount
      ? Math.min(100, Math.round((result.reindexedCount / result.estimatedEntities) * 100))
      : result?.status === 'completed'
        ? 100
        : 0;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Rebuild Index</h2>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Entity Type Filter (optional)
            </label>
            <input
              value={entityTypeFilter}
              onChange={e => setEntityTypeFilter(e.target.value)}
              placeholder="contact, deal, …"
              className="w-full border border-border rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={e => setDryRun(e.target.checked)}
                className="rounded"
              />
              Dry-run only (estimate, no changes)
            </label>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void triggerRebuild()}
            disabled={running}
            className={`px-4 py-2 rounded text-sm font-medium disabled:opacity-50 ${
              dryRun
                ? 'border border-border hover:bg-muted'
                : 'bg-primary text-primary-foreground'
            }`}
          >
            {running
              ? 'Running…'
              : dryRun
                ? 'Estimate Rebuild'
                : 'Rebuild Index'}
          </button>

          {!dryRun && (
            <p className="text-xs text-muted-foreground">
              This will re-extract embeddings for all{entityTypeFilter ? ` ${entityTypeFilter}` : ''}{' '}
              entities. This may take several minutes.
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {result.isDryRun ? 'Dry-run estimate' : 'Rebuild result'}
            </span>
            <span
              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                result.status === 'completed' || result.status === 'dry_run'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {result.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">Estimated entities:</span>{' '}
              <span className="font-medium">
                {result.estimatedEntities?.toLocaleString() ?? '—'}
              </span>
            </div>
            {!result.isDryRun && (
              <div>
                <span className="text-muted-foreground">Re-indexed:</span>{' '}
                <span className="font-medium">
                  {result.reindexedCount?.toLocaleString() ?? '—'}
                </span>
              </div>
            )}
          </div>

          {!result.isDryRun && progressPct > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{progressPct}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {result.completedAt && (
            <p className="text-xs text-muted-foreground">
              Completed at {new Date(result.completedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {history.length > 1 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-2 border-b border-border text-xs font-medium text-muted-foreground bg-muted/50">
            Recent Jobs
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 font-medium">Type filter</th>
                <th className="text-right px-3 py-1.5 font-medium">Entities</th>
                <th className="text-left px-3 py-1.5 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {history.map(job => (
                <tr key={job.jobId} className="border-t border-border">
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-xs ${
                        job.status === 'completed' || job.status === 'dry_run'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {job.entityTypeFilter ?? 'all'}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {job.estimatedEntities?.toLocaleString() ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {new Date(job.startedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
