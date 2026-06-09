'use client';

import { useEffect, useState } from 'react';

type CircuitState = 'closed' | 'open' | 'half-open';

type ServiceStatus = {
  service: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
};

const STATE_COLORS: Record<CircuitState, string> = {
  closed: '#22c55e',
  open: '#ef4444',
  'half-open': '#f59e0b',
};

const STATE_LABELS: Record<CircuitState, string> = {
  closed: 'Healthy',
  open: 'Open (degraded)',
  'half-open': 'Half-open (probing)',
};

export function ResilienceStatus() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/v1/resilience/circuit-breakers');
        if (res.ok) {
          const data = (await res.json()) as { data: ServiceStatus[] };
          setServices(data.data ?? []);
          setLastUpdated(new Date());
        }
      } finally {
        setLoading(false);
      }
    }
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 15_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div style={{ padding: '1rem', color: '#6b7280' }}>Loading circuit breaker states…</div>;
  }

  if (services.length === 0) {
    return (
      <div style={{ padding: '1rem', color: '#6b7280' }}>
        No circuit breaker state recorded yet. All services healthy by default.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Circuit Breaker Status</h3>
        {lastUpdated && (
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>Service</th>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>State</th>
            <th style={{ textAlign: 'right', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>Failures</th>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 600, color: '#374151' }}>Last Failure</th>
          </tr>
        </thead>
        <tbody>
          {services.map((svc) => (
            <tr key={svc.service} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.5rem 0.75rem', color: '#111827' }}>{svc.service}</td>
              <td style={{ padding: '0.5rem 0.75rem' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    backgroundColor: STATE_COLORS[svc.state],
                    display: 'inline-block',
                  }} />
                  <span style={{ color: STATE_COLORS[svc.state], fontWeight: 500 }}>
                    {STATE_LABELS[svc.state]}
                  </span>
                </span>
              </td>
              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', color: svc.failureCount > 0 ? '#ef4444' : '#6b7280' }}>
                {svc.failureCount}
              </td>
              <td style={{ padding: '0.5rem 0.75rem', color: '#6b7280', fontSize: '0.8125rem' }}>
                {svc.lastFailureTime ? new Date(svc.lastFailureTime).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
