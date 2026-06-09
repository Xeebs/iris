'use client';

import { useState } from 'react';

type HealthAlert = {
  alertId: string;
  connectorId: string;
  alertType: string;
  severity: 'warning' | 'critical';
  message: string;
  currentScore?: number | null;
  baselineScore?: number | null;
  createdAt: string;
};

type RecoveryRecommendation = {
  actionType: 're-auth' | 'manual-sync' | 'pause' | 'retry';
  reason: string;
  priority: number;
};

type IncidentResponsePanelProps = {
  alerts: HealthAlert[];
  onResolve?: (alertId: string) => Promise<void>;
  onTakeAction?: (connectorId: string, actionType: RecoveryRecommendation['actionType']) => Promise<void>;
  getRecommendations?: (connectorId: string) => Promise<RecoveryRecommendation[]>;
};

const SEVERITY_COLORS = {
  warning: { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' },
  critical: { bg: '#fee2e2', color: '#991b1b', border: '#fecaca' },
};

const ACTION_LABELS: Record<RecoveryRecommendation['actionType'], string> = {
  're-auth': 'Re-authenticate',
  'manual-sync': 'Trigger Sync',
  'pause': 'Pause Connector',
  'retry': 'Retry Now',
};

export function IncidentResponsePanel({ alerts, onResolve, onTakeAction, getRecommendations }: IncidentResponsePanelProps) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [actioning, setActioning] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, RecoveryRecommendation[]>>({});

  async function handleResolve(alertId: string) {
    if (!onResolve) return;
    setResolving(alertId);
    try { await onResolve(alertId); } finally { setResolving(null); }
  }

  async function handleFetchRecommendations(connectorId: string) {
    if (!getRecommendations || recommendations[connectorId]) return;
    try {
      const recs = await getRecommendations(connectorId);
      setRecommendations((prev) => ({ ...prev, [connectorId]: recs }));
    } catch { /* ignore */ }
  }

  async function handleAction(connectorId: string, actionType: RecoveryRecommendation['actionType']) {
    if (!onTakeAction) return;
    setActioning(`${connectorId}:${actionType}`);
    try { await onTakeAction(connectorId, actionType); } finally { setActioning(null); }
  }

  if (alerts.length === 0) {
    return (
      <div style={{ fontFamily: 'sans-serif', color: '#22c55e', fontSize: '0.875rem', padding: '1rem 1.25rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
        No active incidents — all connectors are healthy.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {alerts.map((alert) => {
        const sc = SEVERITY_COLORS[alert.severity];
        const recs = recommendations[alert.connectorId] ?? [];

        return (
          <div
            key={alert.alertId}
            style={{ border: `1px solid ${sc.border}`, borderRadius: 8, background: sc.bg, overflow: 'hidden' }}
          >
            {/* Alert header */}
            <div style={{ padding: '0.75rem 1rem', borderBottom: `1px solid ${sc.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.2rem' }}>
                  <span style={{ fontWeight: 700, color: sc.color, fontSize: '0.875rem' }}>
                    {alert.severity.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>·</span>
                  <span style={{ fontWeight: 600, color: '#111827', fontSize: '0.875rem' }}>{alert.connectorId}</span>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>({alert.alertType})</span>
                </div>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#374151' }}>{alert.message}</p>
                {alert.currentScore !== null && alert.currentScore !== undefined && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                    Score: {alert.currentScore} (was {alert.baselineScore})
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                  {new Date(alert.createdAt).toLocaleString()}
                </span>
                {onResolve && (
                  <button
                    onClick={() => void handleResolve(alert.alertId)}
                    disabled={resolving === alert.alertId}
                    style={{ padding: '0.25rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.75rem', color: '#374151' }}
                  >
                    {resolving === alert.alertId ? '…' : 'Resolve'}
                  </button>
                )}
              </div>
            </div>

            {/* Runbook / actions */}
            <div style={{ padding: '0.625rem 1rem', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recovery Actions</span>
                {getRecommendations && recs.length === 0 && (
                  <button
                    onClick={() => void handleFetchRecommendations(alert.connectorId)}
                    style={{ fontSize: '0.7rem', color: '#3b82f6', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Load recommendations
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {recs.length > 0 ? (
                  recs.map((rec) => (
                    <button
                      key={rec.actionType}
                      onClick={() => void handleAction(alert.connectorId, rec.actionType)}
                      disabled={actioning === `${alert.connectorId}:${rec.actionType}`}
                      title={rec.reason}
                      style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#f9fafb', cursor: 'pointer', color: '#374151' }}
                    >
                      {actioning === `${alert.connectorId}:${rec.actionType}` ? '…' : ACTION_LABELS[rec.actionType]}
                    </button>
                  ))
                ) : (
                  (['re-auth', 'retry', 'manual-sync'] as const).map((action) => (
                    <button
                      key={action}
                      onClick={() => void handleAction(alert.connectorId, action)}
                      disabled={!!actioning}
                      style={{ padding: '0.25rem 0.7rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#f9fafb', cursor: 'pointer', color: '#374151' }}
                    >
                      {actioning === `${alert.connectorId}:${action}` ? '…' : ACTION_LABELS[action]}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
