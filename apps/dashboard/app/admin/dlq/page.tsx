'use client';

import { useState, useCallback } from 'react';
import { DlqInspector } from '../../../components/dlq-inspector.js';
import type { DlqEntry } from '../../../components/dlq-inspector.js';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

async function fetchDlqEntries(
  workspaceId: string,
  connectorInstanceId: string,
  cursor?: string,
): Promise<{ entries: DlqEntry[]; hasMore: boolean; nextCursor?: string }> {
  const params = new URLSearchParams({ limit: '20' });
  if (workspaceId) params.set('workspaceId', workspaceId);
  if (connectorInstanceId) params.set('connectorInstanceId', connectorInstanceId);
  if (cursor) params.set('cursor', cursor);

  const res = await fetch(`${API_BASE}/admin/dlq?${params.toString()}`, {
    credentials: 'include',
  });

  if (!res.ok) throw new Error(`Failed to fetch DLQ: ${res.statusText}`);

  const body = (await res.json()) as {
    data: DlqEntry[];
    meta: { hasMore: boolean; nextCursor?: string };
  };

  const result: { entries: DlqEntry[]; hasMore: boolean; nextCursor?: string } = {
    entries: body.data,
    hasMore: body.meta.hasMore,
  };
  if (body.meta.nextCursor) result.nextCursor = body.meta.nextCursor;
  return result;
}

async function retryDlqJob(dlqId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/dlq/${dlqId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ retriedBy: 'dashboard-admin' }),
  });

  if (!res.ok) {
    const body = (await res.json()) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Retry failed: ${res.statusText}`);
  }
}

export default function DlqAdminPage() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [connectorId, setConnectorId] = useState('');
  const [entries, setEntries] = useState<DlqEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const nextCursor = reset ? undefined : cursor;
        const result = await fetchDlqEntries(workspaceId, connectorId, nextCursor);
        setEntries((prev) => (reset ? result.entries : [...prev, ...result.entries]));
        setHasMore(result.hasMore);
        setCursor(result.nextCursor);
        setSearched(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    },
    [workspaceId, connectorId, cursor],
  );

  async function handleRetry(dlqId: string) {
    await retryDlqJob(dlqId);
    setEntries((prev) =>
      prev.map((e) =>
        e.id === dlqId
          ? { ...e, retriedAt: new Date().toISOString(), retriedBy: 'dashboard-admin' }
          : e,
      ),
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Dead Letter Queue
      </h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem' }}>
        Connector sync jobs that exhausted all retries. Inspect errors and manually re-enqueue.
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Workspace ID (optional)"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', minWidth: '220px' }}
        />
        <input
          type="text"
          placeholder="Connector Instance ID (UUID)"
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', minWidth: '300px' }}
        />
        <button
          onClick={() => doSearch(true)}
          disabled={loading}
          style={{
            padding: '0.5rem 1.25rem',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.875rem',
          }}
        >
          {loading ? 'Loading…' : 'Search'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {searched && (
        <DlqInspector
          entries={entries}
          hasMore={hasMore}
          loading={loading}
          onLoadMore={() => doSearch(false)}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}
