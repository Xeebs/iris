'use client';

type SpanData = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: 'ok' | 'error' | 'unset';
};

function getDepth(span: SpanData, all: SpanData[]): number {
  if (!span.parentSpanId) return 0;
  const parent = all.find((s) => s.spanId === span.parentSpanId);
  return parent ? 1 + getDepth(parent, all) : 0;
}

function SpanRow({ span, traceStartMs, totalMs, depth }: {
  span: SpanData; traceStartMs: number; totalMs: number; depth: number;
}) {
  const spanStartMs = new Date(span.startedAt).getTime() - traceStartMs;
  const leftPct = totalMs > 0 ? (spanStartMs / totalMs) * 100 : 0;
  const widthPct = totalMs > 0 && span.durationMs ? Math.max((span.durationMs / totalMs) * 100, 0.5) : 1;
  const barColor = span.status === 'error' ? 'bg-red-500/80' : 'bg-blue-500/60 hover:bg-blue-400/80';

  return (
    <div className="flex items-center h-7 relative" style={{ paddingLeft: `${depth * 16}px` }}>
      <div className="w-48 flex-shrink-0 text-xs text-zinc-300 truncate pr-2">{span.operationName}</div>
      <div className="flex-1 relative h-4 bg-zinc-700/30 rounded">
        <div
          className={`absolute top-0 h-full rounded transition-all ${barColor}`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          title={`${span.operationName} — ${span.durationMs ?? '?'}ms`}
        />
      </div>
      <div className="w-16 text-right text-xs text-zinc-500 pl-2 flex-shrink-0">
        {span.durationMs !== null ? `${span.durationMs}ms` : '—'}
      </div>
    </div>
  );
}

export function TraceFlameGraph({ spans }: { spans: SpanData[] }) {
  if (spans.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-center text-zinc-500 text-sm">
        No spans found for this trace.
      </div>
    );
  }

  const traceStartMs = Math.min(...spans.map((s) => new Date(s.startedAt).getTime()));
  const traceEndMs = Math.max(
    ...spans.map((s) => (s.endedAt ? new Date(s.endedAt).getTime() : new Date(s.startedAt).getTime())),
  );
  const totalMs = traceEndMs - traceStartMs;

  const sorted = [...spans].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 space-y-1">
      <div className="flex items-center mb-2">
        <div className="w-48 flex-shrink-0 text-xs text-zinc-500">Operation</div>
        <div className="flex-1 text-xs text-zinc-500">Timeline ({totalMs}ms total)</div>
        <div className="w-16 text-xs text-zinc-500 text-right">Duration</div>
      </div>
      {sorted.map((span) => (
        <SpanRow
          key={span.spanId}
          span={span}
          traceStartMs={traceStartMs}
          totalMs={totalMs}
          depth={getDepth(span, spans)}
        />
      ))}
    </div>
  );
}
