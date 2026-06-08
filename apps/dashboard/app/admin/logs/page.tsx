import type { Metadata } from 'next';
import { RealTimeLogViewer } from '@/components/real-time-log-viewer';

export const metadata: Metadata = { title: 'Log Viewer — Iris Admin' };

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

async function fetchLogs(apiBase: string): Promise<{ logs: LogEntry[]; meta: LogMeta }> {
  try {
    const res = await fetch(`${apiBase}/api/v1/admin/system/logs?limit=50`, { cache: 'no-store' });
    if (!res.ok) return { logs: [], meta: { hasMore: false, nextCursor: null } };
    const body = (await res.json()) as { data: LogEntry[]; meta: LogMeta };
    return { logs: body.data, meta: body.meta };
  } catch {
    return { logs: [], meta: { hasMore: false, nextCursor: null } };
  }
}

export default async function AdminLogsPage() {
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';
  const { logs, meta } = await fetchLogs(apiBase);

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
          Log Viewer
        </h1>
        <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
          Search and filter system audit logs across all services.
        </p>
      </div>

      <RealTimeLogViewer initialLogs={logs} initialMeta={meta} />
    </div>
  );
}
