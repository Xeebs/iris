'use client';

import { useState, useEffect } from 'react';

type ChangeType = 'created' | 'updated' | 'deleted';
type ChangeSource = 'connector_sync' | 'webhook' | 'user_import' | 'manual';

type AuditEvent = {
  id: string;
  entityId: string;
  entityType: string;
  changeType: ChangeType;
  changedBy: ChangeSource;
  sourceConnectorId: string | null;
  oldValuesJson: Record<string, unknown> | null;
  newValuesJson: Record<string, unknown> | null;
  changedFields: string[];
  anomalyFlags: string[];
  timestamp: string;
};

function changeTypeColor(t: ChangeType): string {
  if (t === 'created') return '#22c55e';
  if (t === 'deleted') return '#ef4444';
  return '#3b82f6';
}

function sourceLabel(s: ChangeSource): string {
  const labels: Record<ChangeSource, string> = {
    connector_sync: 'Connector Sync',
    webhook: 'Webhook',
    user_import: 'Import',
    manual: 'Manual',
  };
  return labels[s] ?? s;
}

function FieldDiff({ old: oldVals, next: newVals, fields }: {
  old: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  fields: string[];
}) {
  if (fields.length === 0) return null;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 6 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', padding: '2px 6px', color: '#9ca3af' }}>Field</th>
          <th style={{ textAlign: 'left', padding: '2px 6px', color: '#9ca3af' }}>Before</th>
          <th style={{ textAlign: 'left', padding: '2px 6px', color: '#9ca3af' }}>After</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f}>
            <td style={{ padding: '2px 6px', fontWeight: 600 }}>{f}</td>
            <td style={{ padding: '2px 6px', color: '#ef4444' }}>
              {String(oldVals?.[f] ?? '—')}
            </td>
            <td style={{ padding: '2px 6px', color: '#22c55e' }}>
              {String(newVals?.[f] ?? '—')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditEventCard({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false);
  const dot = changeTypeColor(event.changeType);
  const ts = new Date(event.timestamp).toLocaleString();

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 12, height: 12, borderRadius: '50%', background: dot, marginTop: 4, flexShrink: 0 }} />
        <div style={{ width: 1, flex: 1, background: '#374151', marginTop: 4 }} />
      </div>
      <div style={{ flex: 1, background: '#1f2937', borderRadius: 8, padding: '10px 14px', marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600, textTransform: 'capitalize', color: dot }}>{event.changeType}</span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{ts}</span>
        </div>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
          via {sourceLabel(event.changedBy)}
          {event.sourceConnectorId && ` · ${event.sourceConnectorId}`}
        </div>
        {event.changedFields.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12 }}>
            <button
              onClick={() => setExpanded((e) => !e)}
              style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0, fontSize: 12 }}
            >
              {expanded ? 'Hide' : 'Show'} {event.changedFields.length} changed field{event.changedFields.length !== 1 ? 's' : ''}
            </button>
            {expanded && (
              <FieldDiff old={event.oldValuesJson} next={event.newValuesJson} fields={event.changedFields} />
            )}
          </div>
        )}
        {event.anomalyFlags.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {event.anomalyFlags.map((f) => (
              <span key={f} style={{ background: '#7c2d12', color: '#fca5a5', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export type EntityAuditTimelineProps = {
  entityId: string;
  apiBase?: string;
};

export function EntityAuditTimeline({ entityId, apiBase = '/api/v1' }: EntityAuditTimelineProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/entity-audit/entities/${encodeURIComponent(entityId)}/history?limit=100`)
      .then((r) => r.json())
      .then((body: { data?: AuditEvent[]; error?: { message: string } }) => {
        if (cancelled) return;
        if (body.error) { setError(body.error.message); return; }
        setEvents(body.data ?? []);
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityId, apiBase]);

  if (loading) {
    return <div style={{ padding: 24, color: '#9ca3af' }}>Loading audit trail…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: '#ef4444' }}>Error: {error}</div>;
  }
  if (events.length === 0) {
    return <div style={{ padding: 24, color: '#9ca3af' }}>No change history found.</div>;
  }

  return (
    <div style={{ fontFamily: 'monospace', color: '#f3f4f6' }}>
      <div style={{ marginBottom: 16, fontSize: 14, color: '#9ca3af' }}>
        {events.length} event{events.length !== 1 ? 's' : ''}
      </div>
      {events.map((e) => <AuditEventCard key={e.id} event={e} />)}
    </div>
  );
}
