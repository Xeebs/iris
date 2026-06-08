'use client';

import { useState, useEffect, useCallback } from 'react';

type ValidationFailure = {
  failureId: string;
  entityId: string;
  ruleId: string;
  ruleName: string;
  failureReason: string;
  severity: 'error' | 'warning';
  isBlocking: boolean;
  occurredAt: string;
  acknowledged: boolean;
};

interface ValidationFailureExplorerProps {
  workspaceId: string;
}

/**
 * Paginated explorer for validation failures with acknowledge and filter controls.
 */
export function ValidationFailureExplorer({ workspaceId }: ValidationFailureExplorerProps) {
  const [failures, setFailures] = useState<ValidationFailure[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterAcknowledged, setFilterAcknowledged] = useState<'all' | 'unacknowledged'>('unacknowledged');

  const fetchFailures = useCallback(async (nextCursor?: string) => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        limit: '50',
        ...(filterAcknowledged === 'unacknowledged' ? { acknowledged: 'false' } : {}),
        ...(nextCursor ? { cursor: nextCursor } : {}),
      });
      const res = await fetch(`/api/v1/validation/failures?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as {
        data: ValidationFailure[];
        meta: { nextCursor: string | null; hasMore: boolean };
      };

      if (nextCursor) {
        setFailures(prev => [...prev, ...json.data]);
      } else {
        setFailures(json.data);
      }
      setCursor(json.meta.nextCursor);
      setHasMore(json.meta.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, filterAcknowledged]);

  useEffect(() => {
    void fetchFailures();
  }, [fetchFailures]);

  async function handleAcknowledge(failureId: string) {
    try {
      const res = await fetch(`/api/v1/validation/failures/${failureId}/acknowledge`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await res.text());
      setFailures(prev =>
        prev.map(f => (f.failureId === failureId ? { ...f, acknowledged: true } : f))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Validation Failures</h2>
        <div className="flex items-center gap-2">
          <select
            value={filterAcknowledged}
            onChange={e => setFilterAcknowledged(e.target.value as 'all' | 'unacknowledged')}
            className="border border-border rounded px-2 py-1.5 text-sm"
          >
            <option value="unacknowledged">Unacknowledged only</option>
            <option value="all">All failures</option>
          </select>
          <button
            onClick={() => void fetchFailures()}
            disabled={loading}
            className="px-3 py-1.5 border border-border rounded text-sm disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && failures.length === 0 && (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No validation failures found.
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Entity</th>
                <th className="text-left px-4 py-2 font-medium">Rule</th>
                <th className="text-left px-4 py-2 font-medium">Reason</th>
                <th className="text-left px-4 py-2 font-medium">Severity</th>
                <th className="text-left px-4 py-2 font-medium">Occurred</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr
                  key={f.failureId}
                  className={`border-t border-border transition-colors ${
                    f.acknowledged ? 'opacity-50' : 'hover:bg-muted/30'
                  }`}
                >
                  <td className="px-4 py-2">
                    <code className="text-xs bg-muted px-1 rounded">{f.entityId}</code>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{f.ruleName}</td>
                  <td className="px-4 py-2 max-w-xs truncate" title={f.failureReason}>
                    {f.failureReason}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        f.severity === 'error'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {f.severity}
                      {f.isBlocking && ' · blocking'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {new Date(f.occurredAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!f.acknowledged ? (
                      <button
                        onClick={() => void handleAcknowledge(f.failureId)}
                        className="text-xs text-primary hover:underline"
                      >
                        Acknowledge
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Acknowledged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={() => void fetchFailures(cursor ?? undefined)}
            disabled={loading}
            className="px-4 py-2 border border-border rounded text-sm disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
