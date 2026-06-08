'use client';

type Insight = {
  metricType: string;
  currentRank: number;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
};

type Props = {
  insights: Insight[];
  onOptOut?: () => void;
};

const PRIORITY_STYLE: Record<string, { background: string; color: string; label: string }> = {
  high: { background: '#fee2e2', color: '#b91c1c', label: 'High priority' },
  medium: { background: '#fef9c3', color: '#92400e', label: 'Medium priority' },
  low: { background: '#f0fdf4', color: '#15803d', label: 'Low priority' },
};

/**
 * Panel showing personalized optimization insights based on peer benchmarks.
 *
 * @param insights - Ranked improvement recommendations
 * @param onOptOut - Called when user clicks opt-out
 */
export function BenchmarkInsightsPanel({ insights, onOptOut }: Props) {
  return (
    <div>
      <div style={{
        padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0',
        borderRadius: 8, marginBottom: 16, fontSize: 12, color: '#15803d',
      }}>
        Your workspace data is anonymized before sharing. Only aggregated metrics are used.{' '}
        {onOptOut && (
          <button
            onClick={onOptOut}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', textDecoration: 'underline', fontSize: 12, padding: 0 }}
          >
            Opt out anytime
          </button>
        )}
      </div>

      {insights.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13, padding: 16, textAlign: 'center' }}>
          No insights yet. Enable benchmarking to see how you compare to peers.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {insights.map((insight, i) => {
            const style = PRIORITY_STYLE[insight.priority] ?? PRIORITY_STYLE['low']!;
            return (
              <div
                key={i}
                style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize' }}>
                    {insight.metricType.replace(/_/g, ' ')}
                  </div>
                  <span style={{ ...style, fontSize: 11, padding: '2px 6px', borderRadius: 9999, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {style.label}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
                  {insight.recommendation}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>
                  Currently at {Math.round(insight.currentRank)}th percentile
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
