'use client';

import { useState, useEffect, useCallback } from 'react';

type EntityChange = {
  changeId: string;
  entityId: string;
  entityType: string;
  changeType: 'created' | 'updated' | 'deleted' | 'attribute_changed';
  source: string;
  workspaceId: string;
  changedAt: string;
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  created: '#10b981',
  updated: '#3b82f6',
  deleted: '#ef4444',
  attribute_changed: '#f59e0b',
};

export function EntityChangeFeed({
  entityType,
  refreshIntervalMs = 10000,
}: {
  entityType?: string;
  refreshIntervalMs?: number;
}) {
  const [changes, setChanges] = useState<EntityChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/v1/entities/changes${entityType ? `?entityType=${entityType}` : ''}`;
      const res = await fetch(url);
      const json = await res.json() as { data: EntityChange[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Unknown error');
      setChanges(json.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    void fetchChanges();
    const interval = setInterval(() => void fetchChanges(), refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchChanges, refreshIntervalMs]);

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          {entityType ? `${entityType} Changes` : 'Entity Change Feed'}
        </h3>
        {loading && <span style={{ fontSize: 12, color: '#6b7280' }}>Refreshing…</span>}
        <button
          onClick={() => void fetchChanges()}
          style={{ marginLeft: 'auto', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#dc2626', marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {changes.length === 0 && !loading && (
        <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
          No recent changes.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {changes.map((c) => (
          <div
            key={c.changeId}
            style={{
              padding: '10px 14px',
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderLeft: `4px solid ${CHANGE_TYPE_COLORS[c.changeType] ?? '#9ca3af'}`,
              borderRadius: '0 6px 6px 0',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{
                padding: '1px 7px',
                background: CHANGE_TYPE_COLORS[c.changeType] ?? '#9ca3af',
                color: '#fff',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 600,
              }}>
                {c.changeType}
              </span>
              <span style={{ fontWeight: 500 }}>{c.entityType}</span>
              <code style={{ background: '#f3f4f6', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>{c.entityId}</code>
              {c.source && (
                <span style={{ color: '#6b7280', fontSize: 11 }}>via {c.source}</span>
              )}
            </div>
            <div style={{ color: '#9ca3af', fontSize: 11 }}>
              {new Date(c.changedAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
