'use client';

import { useEffect, useState } from 'react';

type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  durationMs: number | null;
  status: 'ok' | 'error' | 'timeout';
  startedAt: string;
};

type Props = {
  traceId: string;
};

const SERVICE_COLORS: Record<string, string> = {
  api: 'bg-blue-500',
  'mcp-server': 'bg-purple-500',
  connector: 'bg-green-500',
  worker: 'bg-amber-500',
};

/**
 * Gantt-style waterfall visualization of distributed trace spans.
 */
export function TraceWaterfall({ traceId }: Props) {
  const [spans, setSpans] = useState<Span[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/traces/${traceId}`)
      .then((r) => r.json())
      .then((body) => setSpans(body.data ?? []))
      .catch(() => setError('Failed to load trace'))
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-2 rounded-lg border border-gray-200 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-7 rounded bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (spans.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm text-gray-400">Trace not found.</p>
      </div>
    );
  }

  const startMs = Math.min(...spans.map((s) => new Date(s.startedAt).getTime()));
  const endMs = Math.max(
    ...spans.map((s) => new Date(s.startedAt).getTime() + (s.durationMs ?? 0))
  );
  const totalMs = Math.max(1, endMs - startMs);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="font-mono text-xs text-gray-600">Trace: {traceId.slice(0, 16)}…</h3>
        <p className="mt-0.5 text-xs text-gray-400">{spans.length} spans · {totalMs}ms total</p>
      </div>

      <div className="p-4 space-y-1.5">
        {spans.map((span) => {
          const offset = (new Date(span.startedAt).getTime() - startMs) / totalMs;
          const width = Math.max(0.5, ((span.durationMs ?? 0) / totalMs) * 100);
          const barColor = span.status === 'error'
            ? 'bg-red-500'
            : span.status === 'timeout'
              ? 'bg-amber-500'
              : SERVICE_COLORS[span.serviceName] ?? 'bg-gray-400';

          return (
            <div key={span.spanId} className="group flex items-center gap-2">
              <div className="w-40 shrink-0 truncate text-xs text-gray-600" title={span.operationName}>
                {span.operationName}
              </div>
              <div className="relative flex-1 h-5">
                <div className="absolute inset-y-0 w-full rounded-sm bg-gray-50" />
                <div
                  className={`absolute inset-y-0.5 rounded-sm ${barColor} opacity-80`}
                  style={{
                    left: `${offset * 100}%`,
                    width: `${width}%`,
                    minWidth: '2px',
                  }}
                  title={`${span.durationMs ?? 0}ms`}
                />
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-gray-400">
                {span.durationMs !== null ? `${span.durationMs}ms` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-50 px-4 py-2 flex items-center gap-4">
        {Object.entries(SERVICE_COLORS).map(([svc, color]) => (
          <span key={svc} className="flex items-center gap-1 text-xs text-gray-500">
            <span className={`inline-block h-2 w-2 rounded-sm ${color}`} />
            {svc}
          </span>
        ))}
      </div>
    </div>
  );
}
