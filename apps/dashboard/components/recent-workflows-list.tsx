'use client';

import React from 'react';

export type WorkflowSession = {
  session_id: string;
  template_id: string;
  template_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result_summary?: string | null;
  token_usage?: number | null;
  execution_ms?: number | null;
  started_at: string | Date;
  completed_at?: string | null;
};

type Props = {
  sessions: WorkflowSession[];
  onViewResult?: (sessionId: string) => void;
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(d: string | Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function RecentWorkflowsList({ sessions, onViewResult }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400">
        No workflow executions yet. Run your first workflow to see history here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.slice(0, 10).map((s) => (
        <div
          key={s.session_id}
          className="flex items-start gap-3 p-4 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
        >
          <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${STATUS_STYLES[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {s.status}
          </span>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{s.template_name}</p>
            {s.result_summary && (
              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{s.result_summary}</p>
            )}
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-gray-400">{formatDate(s.started_at)}</span>
              {s.execution_ms != null && (
                <span className="text-xs text-gray-400">{formatDuration(s.execution_ms)}</span>
              )}
              {s.token_usage != null && (
                <span className="text-xs text-gray-400">{s.token_usage.toLocaleString()} tokens</span>
              )}
            </div>
          </div>

          {onViewResult && s.status === 'completed' && (
            <button
              type="button"
              onClick={() => onViewResult(s.session_id)}
              className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              View
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
