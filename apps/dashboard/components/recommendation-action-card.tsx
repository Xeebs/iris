'use client';

type ImplementationEffort = 'low' | 'medium' | 'high';

interface RecommendationActionCardProps {
  id: string;
  type: string;
  title: string;
  description: string;
  estimatedSavingsTokensPerDay: number;
  estimatedSavingsCostMonthly: number;
  implementationEffort: ImplementationEffort;
  appliedAt: string | null;
  onApply?: (id: string) => void;
  applying?: boolean;
}

const EFFORT_BADGE: Record<ImplementationEffort, { label: string; color: string }> = {
  low: { label: 'Low effort', color: '#16a34a' },
  medium: { label: 'Medium effort', color: '#d97706' },
  high: { label: 'High effort', color: '#dc2626' },
};

export function RecommendationActionCard({
  id,
  title,
  description,
  estimatedSavingsTokensPerDay,
  estimatedSavingsCostMonthly,
  implementationEffort,
  appliedAt,
  onApply,
  applying = false,
}: RecommendationActionCardProps) {
  const badge = EFFORT_BADGE[implementationEffort];
  const isApplied = appliedAt !== null;

  return (
    <div
      style={{
        padding: '0.875rem 1rem',
        border: '1px solid',
        borderColor: isApplied ? '#d1fae5' : '#e2e8f0',
        borderRadius: '0.625rem',
        background: isApplied ? '#f0fdf4' : 'white',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#0f172a' }}>{title}</span>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: badge.color,
                background: `${badge.color}18`,
                padding: '0.125rem 0.375rem',
                borderRadius: '9999px',
              }}
            >
              {badge.label}
            </span>
            {isApplied && (
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: '#16a34a',
                  background: '#dcfce7',
                  padding: '0.125rem 0.375rem',
                  borderRadius: '9999px',
                }}
              >
                Applied
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#475569', lineHeight: 1.5 }}>{description}</p>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {estimatedSavingsCostMonthly > 0 && (
            <div style={{ fontSize: '0.8125rem', color: '#16a34a', fontWeight: 600 }}>
              ${(estimatedSavingsCostMonthly / 100).toFixed(2)}/mo
            </div>
          )}
          {estimatedSavingsTokensPerDay > 0 && (
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              ~{Math.round(estimatedSavingsTokensPerDay).toLocaleString()} tokens/day
            </div>
          )}
        </div>
      </div>

      {onApply && !isApplied && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => onApply(id)}
            disabled={applying}
            style={{
              padding: '0.375rem 0.875rem',
              background: applying ? '#94a3b8' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: applying ? 'not-allowed' : 'pointer',
            }}
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
}
