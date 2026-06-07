'use client';

import { useState } from 'react';

type SpanEvent = {
  type: 'span';
  timestamp: string;
  data: {
    service: string;
    operation: string;
    durationMs: number;
    statusCode?: number;
    correlationId: string;
  };
};

type AuditEvent = {
  type: 'audit';
  timestamp: string;
  data: {
    id: string;
    action: string;
    actorId: string | null;
    resourceType: string | null;
  };
};

type TimelineEvent = SpanEvent | AuditEvent;

type TraceResult = {
  correlationId: string;
  spanCount: number;
  auditEventCount: number;
  totalDurationMs: number | null;
  timeline: TimelineEvent[];
};

function EventRow({ event }: { event: TimelineEvent }) {
  const ts = new Date(event.timestamp).toLocaleTimeString('en', { hour12: false, fractionalSecondDigits: 3 });
  if (event.type === 'span') {
    const { service, operation, durationMs, statusCode } = event.data;
    const color = statusCode && statusCode >= 500 ? '#ef4444' : statusCode && statusCode >= 400 ? '#f59e0b' : '#22c55e';
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1f2937', fontSize: 13 }}>
        <span style={{ color: '#6b7280', width: 90, flexShrink: 0 }}>{ts}</span>
        <span style={{ background: '#1d4ed8', color: '#bfdbfe', borderRadius: 4, padding: '1px 6px', fontSize: 11, flexShrink: 0 }}>span</span>
        <span style={{ color: '#93c5fd', flexShrink: 0 }}>{service}</span>
        <span style={{ flex: 1, color: '#f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{operation}</span>
        <span style={{ color, flexShrink: 0 }}>{durationMs}ms</span>
        {statusCode && <span style={{ color, flexShrink: 0 }}>{statusCode}</span>}
      </div>
    );
  }
  const { action, actorId, resourceType } = event.data;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid #1f2937', fontSize: 13 }}>
      <span style={{ color: '#6b7280', width: 90, flexShrink: 0 }}>{ts}</span>
      <span style={{ background: '#713f12', color: '#fef3c7', borderRadius: 4, padding: '1px 6px', fontSize: 11, flexShrink: 0 }}>audit</span>
      <span style={{ color: '#a78bfa', flexShrink: 0 }}>{action}</span>
      <span style={{ flex: 1, color: '#9ca3af' }}>{resourceType ?? '—'} · {actorId ?? 'system'}</span>
    </div>
  );
}

export function RequestTraceExplorer({ apiBase = '/api/v1' }: { apiBase?: string }) {
  const [correlationId, setCorrelationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const id = correlationId.trim();
    if (!id) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${apiBase}/admin/request-traces/${encodeURIComponent(id)}`);
      const body = await res.json() as { data?: TraceResult; error?: { message: string } };
      if (body.error) { setError(body.error.message); return; }
      setResult(body.data ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'monospace', color: '#f3f4f6' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={correlationId}
          onChange={(e) => setCorrelationId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
          placeholder="Enter X-Correlation-ID…"
          style={{
            flex: 1, background: '#111827', border: '1px solid #374151', borderRadius: 6,
            color: '#f3f4f6', padding: '8px 12px', fontSize: 13,
          }}
        />
        <button
          onClick={() => void search()}
          disabled={loading || !correlationId.trim()}
          style={{
            background: loading ? '#374151' : '#2563eb', border: 'none', borderRadius: 6,
            color: '#fff', padding: '8px 18px', fontSize: 13, cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>Error: {error}</div>}

      {result && (
        <div>
          <div style={{ display: 'flex', gap: 24, marginBottom: 16, fontSize: 13, color: '#9ca3af' }}>
            <span>{result.spanCount} spans</span>
            <span>{result.auditEventCount} audit events</span>
            {result.totalDurationMs !== null && <span>Total: {result.totalDurationMs}ms</span>}
          </div>
          <div>
            {result.timeline.length === 0
              ? <p style={{ color: '#6b7280' }}>No events found for this correlation ID.</p>
              : result.timeline.map((e, i) => <EventRow key={i} event={e} />)
            }
          </div>
        </div>
      )}
    </div>
  );
}
