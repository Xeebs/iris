import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'System Health — Iris Admin' };

interface HealthCheck {
  status: 'ok' | 'error';
  latencyMs?: number;
  message?: string;
}

interface SystemHealth {
  status: 'ok' | 'degraded';
  checks: Record<string, HealthCheck>;
  timestamp: string;
}

async function fetchSystemHealth(apiBase: string): Promise<SystemHealth | null> {
  try {
    const res = await fetch(`${apiBase}/api/v1/admin/system-health`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: SystemHealth };
    return body.data;
  } catch {
    return null;
  }
}

async function fetchPerfSummary(apiBase: string) {
  try {
    const res = await fetch(`${apiBase}/api/v1/admin/system/performance/summary`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { data: { latency: Record<string, number>; cache: Record<string, number>; sync: Record<string, number> } };
    return body.data;
  } catch {
    return null;
  }
}

const STATUS_COLOR = { ok: '#16a34a', error: '#dc2626', degraded: '#d97706' };

export default async function AdminOverviewPage() {
  const apiBase = process.env.API_BASE_URL ?? 'http://localhost:3001';
  const [health, perf] = await Promise.all([
    fetchSystemHealth(apiBase),
    fetchPerfSummary(apiBase),
  ]);

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', color: '#111827' }}>
        System Health
      </h1>

      {/* Overall status banner */}
      {health && (
        <div style={{
          padding: '0.875rem 1.25rem', borderRadius: '0.5rem', marginBottom: '1.5rem',
          background: health.status === 'ok' ? '#f0fdf4' : '#fef3c7',
          border: `1px solid ${health.status === 'ok' ? '#bbf7d0' : '#fde68a'}`,
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: STATUS_COLOR[health.status], display: 'inline-block' }} />
          <span style={{ fontWeight: 600, color: '#111827' }}>
            Status: {health.status.toUpperCase()} — {new Date(health.timestamp).toLocaleString()}
          </span>
        </div>
      )}

      {/* Per-service checks */}
      {health && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          {Object.entries(health.checks).map(([name, check]) => (
            <div key={name} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'white' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>{name}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[check.status] ?? '#94a3b8', display: 'inline-block' }} />
              </div>
              {check.latencyMs !== undefined && (
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>{check.latencyMs}ms</p>
              )}
              {check.message && (
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>{check.message}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Performance summary cards */}
      {perf && (
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>
            Last 7 Days Performance
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'Avg Latency', value: `${perf.latency['avg_latency_ms'] ?? '—'}ms` },
              { label: 'p95 Latency', value: `${perf.latency['p95_ms'] ?? '—'}ms` },
              { label: 'Total Requests', value: (perf.latency['total_requests'] ?? 0).toLocaleString() },
              { label: 'Cache Hit Rate', value: `${perf.cache['cache_hit_rate_pct'] ?? '—'}%` },
              { label: 'Total Syncs', value: (perf.sync['total_syncs'] ?? 0).toLocaleString() },
              { label: 'Failed Syncs', value: String(perf.sync['failed_syncs'] ?? 0) },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '0.5rem', background: 'white' }}>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>{label}</p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!health && !perf && (
        <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Unable to fetch system health. Check API connectivity.</p>
      )}
    </div>
  );
}
