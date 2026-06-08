'use client';

import { useState, useCallback } from 'react';

interface LogEntry {
  id: string;
  service: string;
  message: string;
  duration_ms: number | null;
  cache_hit: boolean | null;
  token_estimate: number | null;
  timestamp: string;
}

interface LogMeta {
  hasMore: boolean;
  nextCursor: string | null;
}

interface RealTimeLogViewerProps {
  initialLogs: LogEntry[];
  initialMeta: LogMeta;
  apiBase?: string;
}

const LEVEL_COLORS: Record<string, string> = {
  query: '#2563eb',
  info: '#16a34a',
  warn: '#d97706',
  error: '#dc2626',
};

export function RealTimeLogViewer({
  initialLogs,
  initialMeta,
  apiBase = '/api/v1',
}: RealTimeLogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [meta, setMeta] = useState<LogMeta>(initialMeta);
  const [service, setService] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '50' });
      if (service) qs.set('service', service);
      if (keyword) qs.set('keyword', keyword);
      if (cursor) qs.set('cursor', cursor);

      const res = await fetch(`${apiBase}/admin/system/logs?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: LogEntry[]; meta: LogMeta };
      if (cursor) {
        setLogs((prev) => [...prev, ...body.data]);
      } else {
        setLogs(body.data);
      }
      setMeta(body.meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [apiBase, service, keyword]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={service}
          onChange={(e) => setService(e.target.value)}
          placeholder="Filter by service…"
          style={{ flex: '1 1 160px', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        />
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Keyword search…"
          style={{ flex: '2 1 240px', padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        />
        <button
          onClick={() => void fetchLogs()}
          disabled={loading}
          style={{ padding: '0.5rem 1rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <div style={{ background: '#1e1e2e', borderRadius: '0.5rem', overflow: 'hidden', fontFamily: 'monospace' }}>
        {logs.length === 0 ? (
          <p style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem', margin: 0 }}>No log entries found.</p>
        ) : (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {logs.map((entry) => (
              <div key={entry.id} style={{ padding: '0.375rem 0.75rem', borderBottom: '1px solid #2d2d3e', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', fontSize: '0.8125rem' }}>
                <span style={{ color: '#64748b', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span style={{
                  padding: '0.0625rem 0.375rem', borderRadius: '0.25rem', fontSize: '0.6875rem', fontWeight: 700,
                  background: `${LEVEL_COLORS[entry.service] ?? '#64748b'}30`,
                  color: LEVEL_COLORS[entry.service] ?? '#94a3b8',
                  flexShrink: 0,
                }}>
                  {entry.service}
                </span>
                <span style={{ color: '#e2e8f0', flexGrow: 1, wordBreak: 'break-all' }}>{entry.message}</span>
                {entry.duration_ms !== null && (
                  <span style={{ color: '#64748b', fontSize: '0.75rem', flexShrink: 0 }}>{entry.duration_ms}ms</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {meta.hasMore && (
        <button
          onClick={() => void fetchLogs(meta.nextCursor ?? undefined)}
          disabled={loading}
          style={{ padding: '0.5rem', background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem', cursor: 'pointer', color: '#2563eb' }}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
