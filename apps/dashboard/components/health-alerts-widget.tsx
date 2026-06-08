'use client';

type HealthAlert = {
  alertId: string;
  connectorId: string;
  alertType: 'degradation' | 'auth_expiry' | 'sync_failure' | 'stale_data';
  severity: 'warning' | 'critical';
  message: string;
  currentScore: number | null;
  baselineScore: number | null;
  createdAt: string;
};

type HealthAlertsWidgetProps = {
  alerts: HealthAlert[];
  onResolve: (alertId: string) => void;
  resolving: string | null;
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  degradation: 'Score Degradation',
  auth_expiry: 'Auth Expiring',
  sync_failure: 'Sync Failure',
  stale_data: 'Stale Data',
};

/**
 * Compact widget listing active health alerts with resolve buttons.
 */
export function HealthAlertsWidget({ alerts, onResolve, resolving }: HealthAlertsWidgetProps) {
  if (alerts.length === 0) {
    return (
      <div style={{ padding: 14, background: '#f0fdf4', borderRadius: 8, color: '#16a34a', fontSize: 12, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        No active health alerts.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      {alerts.map(a => (
        <div
          key={a.alertId}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            padding: '10px 14px', marginBottom: 8,
            background: a.severity === 'critical' ? '#fef2f2' : '#fffbeb',
            border: `1px solid ${a.severity === 'critical' ? '#fca5a5' : '#fde68a'}`,
            borderRadius: 8,
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 12, color: a.severity === 'critical' ? '#b91c1c' : '#92400e' }}>
                {a.severity === 'critical' ? '🔴' : '🟡'} {ALERT_TYPE_LABEL[a.alertType] ?? a.alertType}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{a.connectorId}</span>
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 3 }}>{a.message}</div>
            {a.currentScore !== null && a.baselineScore !== null && (
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                Score: <strong>{a.currentScore}</strong> → baseline <strong>{a.baselineScore}</strong>
              </div>
            )}
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              {new Date(a.createdAt).toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => onResolve(a.alertId)}
            disabled={resolving === a.alertId}
            style={{
              marginLeft: 12, padding: '4px 12px', fontSize: 11,
              border: '1px solid #d1d5db', borderRadius: 5,
              background: resolving === a.alertId ? '#f3f4f6' : '#fff',
              cursor: resolving === a.alertId ? 'not-allowed' : 'pointer',
              color: '#374151',
            }}
          >
            {resolving === a.alertId ? '…' : 'Dismiss'}
          </button>
        </div>
      ))}
    </div>
  );
}
