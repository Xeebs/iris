'use client';

type Issue = {
  issue_id: string;
  entity_id: string;
  issue_type: string;
  severity: 'low' | 'medium' | 'high';
  field_name: string | null;
  resolved_at: string | null;
  connector_id?: string;
};

const SEVERITY_CLASSES: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  low: 'bg-zinc-700 text-zinc-400',
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  required_field_missing: 'Missing field',
  type_mismatch: 'Type mismatch',
  invalid_format: 'Invalid format',
  outlier: 'Outlier',
};

type DataQualityIssuesTableProps = {
  issues: Issue[];
  onResolve?: (issueId: string) => Promise<void>;
  resolvingId?: string | null;
};

export function DataQualityIssuesTable({ issues, onResolve, resolvingId }: DataQualityIssuesTableProps) {
  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
        No issues found.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700 overflow-hidden">
      <div className="px-4 py-2 grid grid-cols-[1fr_120px_100px_80px_80px] gap-3 text-xs font-medium text-zinc-500 uppercase tracking-wide">
        <span>Entity</span>
        <span>Issue Type</span>
        <span>Field</span>
        <span>Severity</span>
        <span></span>
      </div>
      {issues.map((issue) => (
        <div
          key={issue.issue_id}
          className="px-4 py-3 grid grid-cols-[1fr_120px_100px_80px_80px] gap-3 items-center"
        >
          <div className="min-w-0">
            <div className="text-sm text-zinc-200 font-mono truncate">{issue.entity_id}</div>
            {issue.connector_id && (
              <div className="text-xs text-zinc-500 mt-0.5">{issue.connector_id}</div>
            )}
          </div>
          <span className="text-xs text-zinc-300">
            {ISSUE_TYPE_LABELS[issue.issue_type] ?? issue.issue_type}
          </span>
          <span className="text-xs text-zinc-400 font-mono truncate">{issue.field_name ?? '—'}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium w-fit ${SEVERITY_CLASSES[issue.severity] ?? ''}`}>
            {issue.severity}
          </span>
          <div className="flex justify-end">
            {issue.resolved_at ? (
              <span className="text-xs text-green-400">resolved</span>
            ) : onResolve ? (
              <button
                onClick={() => void onResolve(issue.issue_id)}
                disabled={resolvingId === issue.issue_id}
                className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded disabled:opacity-50"
              >
                {resolvingId === issue.issue_id ? '…' : 'Resolve'}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
