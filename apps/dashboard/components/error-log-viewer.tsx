'use client';

import { useState } from 'react';

export interface SyncLogEntry {
  id: string;
  syncId: string;
  eventType: string;
  severity: string;
  message: string;
  details: unknown;
  timestamp: string;
}

type Props = {
  logs: SyncLogEntry[];
  hasMore: boolean;
  onLoadMore: () => void;
  loading?: boolean;
};

const SEVERITY_STYLES: Record<string, string> = {
  error: 'text-red-600 bg-red-50',
  warn:  'text-yellow-700 bg-yellow-50',
  info:  'text-gray-700 bg-gray-50',
  debug: 'text-gray-400 bg-gray-50',
};

const EVENT_ICONS: Record<string, string> = {
  failed:    '✕',
  retry:     '↺',
  warning:   '⚠',
  completed: '✓',
  started:   '▶',
};

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ErrorLogViewer({ logs, hasMore, onLoadMore, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (logs.length === 0 && !loading) {
    return <p className="py-8 text-center text-sm text-gray-400">No sync events recorded yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="font-mono text-xs space-y-1">
        {logs.map((e) => (
          <div key={e.id} className={`rounded p-2 ${SEVERITY_STYLES[e.severity] ?? SEVERITY_STYLES['info']}`}>
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-px w-4 text-center">
                {EVENT_ICONS[e.eventType] ?? '•'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-gray-400">{formatTs(e.timestamp)}</span>
                  <span className="uppercase tracking-wide">{e.eventType}</span>
                  <span className="text-gray-400">#{e.syncId.slice(-8)}</span>
                </div>
                <p className="break-words">{e.message}</p>
                {e.details != null && (
                  <button
                    onClick={() => toggle(e.id)}
                    className="mt-1 text-gray-400 hover:text-gray-600 underline text-xs"
                  >
                    {expanded.has(e.id) ? 'Hide details' : 'Show details'}
                  </button>
                )}
                {expanded.has(e.id) && e.details != null && (
                  <pre className="mt-2 p-2 bg-white/60 rounded text-gray-600 overflow-auto max-h-48 text-xs whitespace-pre-wrap break-all">
                    {JSON.stringify(e.details, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loading}
          className="w-full py-2 border rounded text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
