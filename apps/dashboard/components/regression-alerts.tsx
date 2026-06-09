'use client';

type RegressionReport = {
  connectorId: string;
  entityType: string;
  hasRegression: boolean;
  throughputDeltaPct: number;
  memoryDeltaPct: number;
  details: string;
};

type RegressionAlertsProps = {
  reports: RegressionReport[];
  onDismiss?: (connectorId: string, entityType: string) => void;
};

export function RegressionAlerts({ reports, onDismiss }: RegressionAlertsProps) {
  const regressions = reports.filter((r) => r.hasRegression);

  if (regressions.length === 0) {
    return (
      <div style={{ padding: '0.75rem 1rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, fontSize: '0.875rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span>✓</span> All connectors performing within baseline bounds
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontFamily: 'sans-serif' }}>
      {regressions.map((r) => (
        <div
          key={`${r.connectorId}-${r.entityType}`}
          style={{
            border: '1px solid #fca5a5', borderLeft: '4px solid #ef4444',
            borderRadius: 6, padding: '0.6rem 0.75rem', background: '#fef2f2',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
              Performance regression: {r.connectorId} / {r.entityType}
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#374151' }}>{r.details}</div>
            <div style={{ marginTop: '0.25rem', display: 'flex', gap: '1rem', fontSize: '0.8125rem' }}>
              {r.throughputDeltaPct < 0 && (
                <span style={{ color: '#dc2626' }}>
                  Throughput: {r.throughputDeltaPct.toFixed(1)}%
                </span>
              )}
              {r.memoryDeltaPct > 0 && (
                <span style={{ color: '#f59e0b' }}>
                  Memory: +{r.memoryDeltaPct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          {onDismiss && (
            <button
              onClick={() => onDismiss(r.connectorId, r.entityType)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', fontSize: '1.1rem', padding: '0.1rem 0.3rem' }}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
