'use client';

import { useState, useEffect } from 'react';

type ErrorCategory =
  | 'auth_failure' | 'rate_limit' | 'network_timeout'
  | 'schema_mismatch' | 'data_validation' | 'quota_exceeded' | 'unknown';

type RecoverySuggestion = {
  action: string;
  description: string;
  automated: boolean;
};

type SyncDiagnostic = {
  id: string;
  syncJobId: string;
  errorCategory: ErrorCategory;
  errorMessage: string;
  recoverySuggestions: RecoverySuggestion[];
  isResolved: boolean;
  resolvedAt: string | null;
  createdAt: string;
};

type ConnectorHealth = {
  errorRate: number;
  dominantCategory: ErrorCategory | null;
  patterns: string[];
  healthStatus: 'healthy' | 'degraded' | 'failing';
};

const CATEGORY_COLOR: Record<ErrorCategory, string> = {
  auth_failure: '#ef4444',
  rate_limit: '#f59e0b',
  network_timeout: '#8b5cf6',
  schema_mismatch: '#3b82f6',
  data_validation: '#ec4899',
  quota_exceeded: '#f97316',
  unknown: '#6b7280',
};

function HealthBadge({ status }: { status: ConnectorHealth['healthStatus'] }) {
  const color = status === 'healthy' ? '#22c55e' : status === 'degraded' ? '#f59e0b' : '#ef4444';
  return (
    <span style={{ background: `${color}22`, color, borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
      {status}
    </span>
  );
}

function DiagnosticCard({ diag, onResolve }: { diag: SyncDiagnostic; onResolve: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const color = CATEGORY_COLOR[diag.errorCategory];
  const ts = new Date(diag.createdAt).toLocaleString();

  return (
    <div style={{ background: '#1f2937', borderRadius: 8, padding: '12px 16px', marginBottom: 10, borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: `${color}22`, color, borderRadius: 4, padding: '1px 6px', fontSize: 11, textTransform: 'replace' }}>{diag.errorCategory.replace('_', ' ')}</span>
          {diag.isResolved && <span style={{ color: '#22c55e', fontSize: 11 }}>✓ Resolved</span>}
        </div>
        <span style={{ fontSize: 11, color: '#6b7280' }}>{ts}</span>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#f3f4f6' }}>{diag.errorMessage}</p>
      {diag.recoverySuggestions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0, fontSize: 12 }}
          >
            {expanded ? 'Hide' : 'Show'} {diag.recoverySuggestions.length} recovery suggestion{diag.recoverySuggestions.length !== 1 ? 's' : ''}
          </button>
          {expanded && (
            <ul style={{ margin: '6px 0 0 0', padding: '0 0 0 16px', listStyle: 'disc' }}>
              {diag.recoverySuggestions.map((s) => (
                <li key={s.action} style={{ fontSize: 12, color: '#d1d5db', marginBottom: 3 }}>
                  <strong style={{ color: '#f3f4f6' }}>{s.action}:</strong> {s.description}
                  {s.automated && <span style={{ color: '#22c55e', marginLeft: 6, fontSize: 11 }}>[automated]</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!diag.isResolved && (
        <button
          onClick={() => onResolve(diag.id)}
          style={{
            marginTop: 10, background: 'none', border: '1px solid #374151', borderRadius: 6,
            color: '#9ca3af', padding: '4px 10px', fontSize: 11, cursor: 'pointer',
          }}
        >
          Mark resolved
        </button>
      )}
    </div>
  );
}

export type SyncErrorDiagnosticProps = {
  connectorInstanceId: string;
  apiBase?: string;
};

export function SyncErrorDiagnostic({ connectorInstanceId, apiBase = '/api/v1' }: SyncErrorDiagnosticProps) {
  const [diagnostics, setDiagnostics] = useState<SyncDiagnostic[]>([]);
  const [health, setHealth] = useState<ConnectorHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`${apiBase}/admin/sync-diagnostics/${encodeURIComponent(connectorInstanceId)}`)
      .then((r) => r.json())
      .then((body: { data?: { diagnostics: SyncDiagnostic[]; health: ConnectorHealth }; error?: { message: string } }) => {
        if (body.error) { setError(body.error.message); return; }
        setDiagnostics(body.data?.diagnostics ?? []);
        setHealth(body.data?.health ?? null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [connectorInstanceId, apiBase]);

  const handleResolve = (id: string) => {
    fetch(`${apiBase}/admin/sync-diagnostics/${id}/resolve`, { method: 'POST' })
      .then(() => load())
      .catch(() => null);
  };

  if (loading) return <div style={{ padding: 16, color: '#9ca3af' }}>Loading diagnostics…</div>;
  if (error) return <div style={{ padding: 16, color: '#ef4444' }}>Error: {error}</div>;

  return (
    <div style={{ fontFamily: 'monospace', color: '#f3f4f6' }}>
      {health && (
        <div style={{ background: '#111827', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13 }}>Connector Health:</span>
          <HealthBadge status={health.healthStatus} />
          <span style={{ fontSize: 12, color: '#9ca3af' }}>Error rate: {Math.round(health.errorRate * 100)}%</span>
          {health.patterns.map((p) => (
            <span key={p} style={{ fontSize: 11, color: '#f59e0b', background: '#451a0322', borderRadius: 4, padding: '1px 6px' }}>{p}</span>
          ))}
        </div>
      )}

      {diagnostics.length === 0
        ? <p style={{ color: '#6b7280' }}>No sync errors recorded.</p>
        : diagnostics.map((d) => <DiagnosticCard key={d.id} diag={d} onResolve={handleResolve} />)
      }
    </div>
  );
}
