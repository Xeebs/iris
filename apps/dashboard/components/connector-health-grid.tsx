'use client';

type HealthEntry = {
  connectorId: string;
  overallScore: number;
  grade: string;
  syncSuccessRate: number;
  entityFreshness: number;
  errorFrequency: number;
  authValidity: number;
  scoredAt: string;
};

type ConnectorHealthGridProps = {
  entries: HealthEntry[];
  onSelectConnector?: (connectorId: string) => void;
  selectedConnectorId?: string;
};

const GRADE_COLORS: Record<string, { bg: string; color: string }> = {
  A: { bg: '#dcfce7', color: '#166534' },
  B: { bg: '#d1fae5', color: '#065f46' },
  C: { bg: '#fef9c3', color: '#854d0e' },
  D: { bg: '#ffedd5', color: '#9a3412' },
  F: { bg: '#fee2e2', color: '#991b1b' },
};

function ScoreBar({ value, maxWidth = 100 }: { value: number; maxWidth?: number }) {
  const pct = Math.round(value * 100);
  const barColor = pct >= 90 ? '#22c55e' : pct >= 70 ? '#eab308' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      <div style={{ flex: 1, height: 6, background: '#f3f4f6', borderRadius: 3, maxWidth }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.7rem', color: '#6b7280', width: 28, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

export function ConnectorHealthGrid({ entries, onSelectConnector, selectedConnectorId }: ConnectorHealthGridProps) {
  if (entries.length === 0) {
    return (
      <div style={{ fontFamily: 'sans-serif', color: '#9ca3af', fontSize: '0.875rem', padding: '1.5rem', textAlign: 'center', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
        No health data available. Run a health check to populate scores.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
      {entries.map((e) => {
        const gradeStyle = GRADE_COLORS[e.grade] ?? GRADE_COLORS['F']!;
        const isSelected = selectedConnectorId === e.connectorId;
        return (
          <div
            key={e.connectorId}
            onClick={() => onSelectConnector?.(e.connectorId)}
            style={{
              border: `1px solid ${isSelected ? '#3b82f6' : '#e5e7eb'}`,
              borderRadius: 8,
              padding: '0.875rem',
              cursor: onSelectConnector ? 'pointer' : 'default',
              background: isSelected ? '#eff6ff' : '#fff',
              boxShadow: isSelected ? '0 0 0 2px #bfdbfe' : 'none',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#111827' }}>{e.connectorId}</span>
              <span style={{ padding: '0.2rem 0.5rem', borderRadius: 5, fontWeight: 800, fontSize: '1rem', background: gradeStyle.bg, color: gradeStyle.color }}>
                {e.grade}
              </span>
            </div>

            <div style={{ fontSize: '1.375rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
              {e.overallScore}
              <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontWeight: 400 }}>/100</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Sync Success</div>
              <ScoreBar value={e.syncSuccessRate} />
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Freshness</div>
              <ScoreBar value={e.entityFreshness} />
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Error Rate</div>
              <ScoreBar value={e.errorFrequency} />
              <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>Auth</div>
              <ScoreBar value={e.authValidity} />
            </div>

            <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#9ca3af' }}>
              {new Date(e.scoredAt).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
