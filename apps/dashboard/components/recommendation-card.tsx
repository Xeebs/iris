'use client';

interface RecommendationCardProps {
  id: string;
  title: string;
  description: string;
  estimatedSavingsCostMonthly: number;
  implementationEffort: 'low' | 'medium' | 'high';
  appliedAt: string | null;
  onApply?: (id: string) => Promise<void>;
  applying?: boolean;
}

const EFFORT_COLORS = {
  low: { bg: '#f0fdf4', text: '#16a34a', border: '#bbf7d0' },
  medium: { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  high: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Card displaying a single cost optimization recommendation with an apply button.
 */
export function RecommendationCard({
  id,
  title,
  description,
  estimatedSavingsCostMonthly,
  implementationEffort,
  appliedAt,
  onApply,
  applying = false,
}: RecommendationCardProps) {
  const effortStyle = EFFORT_COLORS[implementationEffort];

  return (
    <div style={{
      border: appliedAt ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
      borderRadius: '0.5rem',
      padding: '1.25rem',
      background: appliedAt ? '#f0fdf4' : 'white',
      display: 'flex',
      gap: '1rem',
      alignItems: 'flex-start',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#111827' }}>{title}</span>
          <span style={{
            padding: '0.125rem 0.5rem',
            borderRadius: '9999px',
            fontSize: '0.6875rem',
            fontWeight: 700,
            background: effortStyle.bg,
            color: effortStyle.text,
            border: `1px solid ${effortStyle.border}`,
          }}>
            {implementationEffort} effort
          </span>
        </div>
        <p style={{ margin: '0 0 0.625rem', fontSize: '0.8125rem', color: '#374151' }}>{description}</p>
        <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
          Est. savings: <strong style={{ color: '#16a34a' }}>{formatCents(estimatedSavingsCostMonthly)}/month</strong>
        </p>
        {appliedAt && (
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#16a34a' }}>
            Applied {new Date(appliedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {!appliedAt && onApply && (
        <button
          onClick={() => void onApply(id)}
          disabled={applying}
          style={{
            padding: '0.5rem 1rem',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: applying ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      )}
    </div>
  );
}
