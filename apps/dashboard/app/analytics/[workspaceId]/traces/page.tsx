'use client';

import { useEffect, useState } from 'react';
import { TraceFlameGraph } from '../../../../components/trace-flame-graph.js';
import { TraceLatencyHistogram } from '../../../../components/trace-latency-histogram.js';

type TraceRow = {
  traceId: string;
  rootOperation: string;
  totalSpans: number;
  startedAt: string;
  durationMs: number | null;
  status: 'ok' | 'error' | 'unset';
};

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

type Percentiles = { p50: number; p95: number; p99: number };

const WATCHED_OPERATIONS = ['mcp.query-context', 'connector.sync', 'indexer.index', 'api.request'];

export default function TracesPage({ params }: { params: { workspaceId: string } }) {
  const { workspaceId } = params;
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [spans, setSpans] = useState<SpanData[]>([]);
  const [percentiles, setPercentiles] = useState<Record<string, Percentiles>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v1/tracing/traces?workspaceId=${workspaceId}`)
      .then((r) => r.json())
      .then((j) => setTraces(j.data ?? []))
      .finally(() => setLoading(false));

    Promise.all(
      WATCHED_OPERATIONS.map((op) =>
        fetch(`/api/v1/tracing/latency?operation=${encodeURIComponent(op)}`)
          .then((r) => r.json())
          .then((j) => ({ op, data: j.data as Percentiles }))
          .catch(() => ({ op, data: { p50: 0, p95: 0, p99: 0 } })),
      ),
    ).then((results) => {
      const map: Record<string, Percentiles> = {};
      for (const { op, data } of results) map[op] = data;
      setPercentiles(map);
    });
  }, [workspaceId]);

  async function loadTrace(traceId: string) {
    setSelectedTraceId(traceId);
    const res = await fetch(`/api/v1/tracing/traces/${traceId}`);
    const json = await res.json();
    setSpans(json.data ?? []);
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Distributed Traces</h1>
        <p className="text-sm text-zinc-400 mt-1">Workspace: {workspaceId}</p>
      </div>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Latency by Operation</h2>
        <div className="grid grid-cols-2 gap-4">
          {WATCHED_OPERATIONS.map((op) => (
            <TraceLatencyHistogram key={op} operationName={op} percentiles={percentiles[op] ?? { p50: 0, p95: 0, p99: 0 }} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">Recent Traces</h2>
        {loading && <div className="text-zinc-500 text-sm">Loading…</div>}
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700">
          {traces.map((t) => (
            <button
              key={t.traceId}
              onClick={() => loadTrace(t.traceId)}
              className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-700/50 transition-colors ${selectedTraceId === t.traceId ? 'bg-zinc-700/40' : ''}`}
            >
              <div>
                <div className="text-sm font-medium text-zinc-200">{t.rootOperation}</div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {new Date(t.startedAt).toLocaleString()} · {t.totalSpans} span{t.totalSpans !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {t.durationMs !== null && (
                  <span className="text-xs text-zinc-400">{t.durationMs.toFixed(0)}ms</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded ${t.status === 'error' ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                  {t.status}
                </span>
              </div>
            </button>
          ))}
          {!loading && traces.length === 0 && (
            <div className="px-4 py-6 text-center text-zinc-500 text-sm">No traces recorded yet.</div>
          )}
        </div>
      </section>

      {selectedTraceId && spans.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider mb-3">
            Trace: <span className="font-mono text-zinc-300">{selectedTraceId.slice(0, 16)}…</span>
          </h2>
          <TraceFlameGraph spans={spans} />
        </section>
      )}
    </div>
  );
}
