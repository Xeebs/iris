'use client';

import { useEffect, useRef, useState } from 'react';

type ChangeEvent = {
  changeId: string;
  entityId: string;
  entityType: string;
  changeType: 'created' | 'updated' | 'deleted' | 'attribute_changed';
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  source: string;
  changedAt: string;
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  created: '#22c55e',
  updated: '#3b82f6',
  deleted: '#ef4444',
  attribute_changed: '#f59e0b',
};

export default function EntityMonitorPage() {
  const [entityId, setEntityId] = useState('');
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  function connect() {
    if (!entityId.trim()) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/v1/entity-change-stream/${entityId}/changes/stream`);
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as ChangeEvent;
        setEvents((prev) => [event, ...prev].slice(0, 200));
      } catch {
        // ignore malformed messages
      }
    };
  }

  function disconnect() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setConnected(false);
  }

  useEffect(() => () => disconnect(), []);

  function toggleExpanded(changeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(changeId)) next.delete(changeId);
      else next.add(changeId);
      return next;
    });
  }

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 800 }}>
      <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700 }}>Entity Change Monitor</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Entity ID (e.g. hubspot:contact:123)"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          style={{ flex: 1, padding: '0.4rem 0.75rem', borderRadius: 6, border: '1px solid #d1d5db', fontSize: '0.875rem' }}
        />
        <button
          onClick={connected ? disconnect : connect}
          style={{
            padding: '0.4rem 1rem',
            borderRadius: 6,
            border: 'none',
            background: connected ? '#ef4444' : '#3b82f6',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          backgroundColor: connected ? '#22c55e' : '#9ca3af',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
          {connected ? `Monitoring ${entityId}` : 'Not connected'}
        </span>
        {events.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: '#9ca3af' }}>
            {events.length} event{events.length !== 1 ? 's' : ''} received
          </span>
        )}
      </div>

      {events.length === 0 && connected && (
        <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>Waiting for changes…</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {events.map((evt) => (
          <div key={evt.changeId} style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div
              onClick={() => toggleExpanded(evt.changeId)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.6rem 0.75rem', cursor: 'pointer', background: '#f9fafb',
              }}
            >
              <span style={{
                background: CHANGE_TYPE_COLORS[evt.changeType] ?? '#6b7280',
                color: '#fff', fontSize: '0.7rem', padding: '0.1rem 0.4rem',
                borderRadius: 4, fontWeight: 600, textTransform: 'uppercase',
              }}>
                {evt.changeType}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem', color: '#374151' }}>{evt.entityType}</span>
              <span style={{ fontSize: '0.8125rem', color: '#6b7280', marginLeft: 'auto' }}>
                {new Date(evt.changedAt).toLocaleTimeString()}
              </span>
              <span style={{ color: '#9ca3af' }}>{expanded.has(evt.changeId) ? '▲' : '▼'}</span>
            </div>

            {expanded.has(evt.changeId) && (
              <div style={{ padding: '0.75rem', background: '#fff', borderTop: '1px solid #e5e7eb' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8125rem' }}>
                  {evt.previousValue && (
                    <div>
                      <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: '0.25rem' }}>Before</div>
                      <pre style={{ margin: 0, background: '#fef2f2', padding: '0.5rem', borderRadius: 4, overflow: 'auto' }}>
                        {JSON.stringify(evt.previousValue, null, 2)}
                      </pre>
                    </div>
                  )}
                  {evt.newValue && (
                    <div>
                      <div style={{ fontWeight: 600, color: '#6b7280', marginBottom: '0.25rem' }}>After</div>
                      <pre style={{ margin: 0, background: '#f0fdf4', padding: '0.5rem', borderRadius: 4, overflow: 'auto' }}>
                        {JSON.stringify(evt.newValue, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                  Source: {evt.source} · ID: {evt.changeId}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
