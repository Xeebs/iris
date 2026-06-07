'use client';

interface SlowQuery {
  queryHash: string;
  queryText: string | null;
  p50Ms: number;
  p95Ms: number;
  callCount: number;
  avgResultSize: number | null;
}

interface SlowQueryExplorerProps {
  queries: SlowQuery[];
  loading: boolean;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function SlowQueryExplorer({ queries, loading }: SlowQueryExplorerProps) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading slow queries…</p>;
  if (queries.length === 0) return <p className="text-sm text-muted-foreground">No slow queries detected in this period.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="pb-2 pr-4">Query</th>
            <th className="pb-2 pr-4 text-right">Calls</th>
            <th className="pb-2 pr-4 text-right">p50</th>
            <th className="pb-2 pr-4 text-right">p95</th>
            <th className="pb-2 text-right">Avg results</th>
          </tr>
        </thead>
        <tbody>
          {queries.map((q) => (
            <tr key={q.queryHash} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="py-2 pr-4 max-w-xs">
                <span className="truncate block text-xs font-mono text-muted-foreground" title={q.queryText ?? q.queryHash}>
                  {q.queryText ?? q.queryHash}
                </span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{q.callCount}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{formatMs(q.p50Ms)}</td>
              <td className={`py-2 pr-4 text-right tabular-nums font-medium ${q.p95Ms > 2000 ? 'text-destructive' : q.p95Ms > 1000 ? 'text-yellow-600' : ''}`}>
                {formatMs(q.p95Ms)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {q.avgResultSize != null ? q.avgResultSize : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
