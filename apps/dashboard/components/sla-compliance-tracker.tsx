'use client';

type SlaBreach = {
  breachId: string;
  breachType: string;
  actualValue: number;
  targetValue: number;
  breachStartedAt: string;
  breachResolvedAt?: string | null;
  description?: string | null;
};

type SlaComplianceTrackerProps = {
  connectorId: string;
  breaches: SlaBreach[];
  slaTarget?: {
    minHealthScore: number;
    minSyncSuccessRate: number;
    uptimeTargetPct: number;
    measurementWindowDays: number;
  } | null;
};

const BREACH_TYPE_LABELS: Record<string, string> = {
  health_score: 'Health Score',
  sync_success_rate: 'Sync Success Rate',
  latency: 'Latency',
  uptime: 'Uptime',
};

export function SlaComplianceTracker({ connectorId, breaches, slaTarget }: SlaComplianceTrackerProps) {
  const activeBreaches = breaches.filter((b) => !b.breachResolvedAt);
  const resolvedBreaches = breaches.filter((b) => b.breachResolvedAt);
  const uptimePct = breaches.length === 0 ? 100 :
    Math.round((1 - activeBreaches.length / Math.max(1, breaches.length)) * 1000) / 10;

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      {/* SLA targets summary */}
      {slaTarget && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {[
            { label: 'Min Health Score', value: `${slaTarget.minHealthScore}/100` },
            { label: 'Min Sync Success', value: `${(slaTarget.minSyncSuccessRate * 100).toFixed(1)}%` },
            { label: 'Uptime Target', value: `${slaTarget.uptimeTargetPct}%` },
            { label: 'Window', value: `${slaTarget.measurementWindowDays}d` },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.6rem 0.875rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#111827' }}>{value}</div>
            </div>
          ))}
          <div style={{ background: uptimePct >= (slaTarget.uptimeTargetPct) ? '#f0fdf4' : '#fff5f5', border: `1px solid ${uptimePct >= slaTarget.uptimeTargetPct ? '#bbf7d0' : '#fca5a5'}`, borderRadius: 6, padding: '0.6rem 0.875rem' }}>
            <div style={{ fontSize: '0.7rem', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Compliance</div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: uptimePct >= slaTarget.uptimeTargetPct ? '#166534' : '#991b1b' }}>{uptimePct}%</div>
          </div>
        </div>
      )}

      {/* Breach timeline */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#111827' }}>
          SLA Breaches — {connectorId}
        </h3>
        {breaches.length > 0 && (
          <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
            {activeBreaches.length} active · {resolvedBreaches.length} resolved
          </span>
        )}
      </div>

      {breaches.length === 0 ? (
        <div style={{ color: '#22c55e', fontWeight: 500, fontSize: '0.875rem', padding: '1rem', background: '#f0fdf4', borderRadius: 6, border: '1px solid #bbf7d0' }}>
          No SLA breaches recorded — compliance is within targets.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {breaches.map((b) => {
            const isActive = !b.breachResolvedAt;
            return (
              <div
                key={b.breachId}
                style={{ border: `1px solid ${isActive ? '#fca5a5' : '#e5e7eb'}`, borderRadius: 6, padding: '0.75rem', background: isActive ? '#fff5f5' : '#fff' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>
                      {BREACH_TYPE_LABELS[b.breachType] ?? b.breachType}
                    </span>
                    <span style={{ padding: '0.15rem 0.45rem', borderRadius: 10, fontSize: '0.7rem', fontWeight: 600, background: isActive ? '#fee2e2' : '#f3f4f6', color: isActive ? '#991b1b' : '#6b7280' }}>
                      {isActive ? 'Active' : 'Resolved'}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    {new Date(b.breachStartedAt).toLocaleString()}
                  </span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: '#374151' }}>
                  Actual: <strong>{(b.actualValue * 100).toFixed(1)}%</strong> vs target: {(b.targetValue * 100).toFixed(1)}%
                </div>
                {b.description && (
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }}>{b.description}</div>
                )}
                {b.breachResolvedAt && (
                  <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '0.25rem' }}>
                    Resolved: {new Date(b.breachResolvedAt).toLocaleString()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
