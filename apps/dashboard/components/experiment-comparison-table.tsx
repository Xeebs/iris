'use client';

export interface ExperimentStrategyResult {
  strategyName: string;
  metrics: {
    precisionAtK: number;
    recallAtK: number;
    ndcgAtK: number;
    mrr: number;
    sampleSize: number;
  };
}

interface ExperimentComparisonTableProps {
  results: ExperimentStrategyResult[];
  winner?: string | null;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function delta(a: number, b: number): React.JSX.Element {
  const d = b - a;
  if (Math.abs(d) < 0.001) return <span style={{ color: '#94a3b8' }}>—</span>;
  const color = d > 0 ? '#16a34a' : '#dc2626';
  return <span style={{ color, fontWeight: 600 }}>{d > 0 ? '+' : ''}{pct(d)}</span>;
}

export function ExperimentComparisonTable({ results, winner }: ExperimentComparisonTableProps) {
  if (results.length === 0) {
    return (
      <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>
        No experiment results yet. Results will appear as queries are measured.
      </div>
    );
  }

  const [control, treatment] = results.length >= 2
    ? [results[0]!, results[1]!]
    : [results[0]!, null];

  const headers = ['Metric', 'Control', ...(treatment ? ['Treatment', 'Δ'] : [])];

  const rows: Array<{ label: string; ctrlVal: number; trtVal?: number }> = [
    { label: 'Precision@K', ctrlVal: control.metrics.precisionAtK, trtVal: treatment?.metrics.precisionAtK },
    { label: 'Recall@K', ctrlVal: control.metrics.recallAtK, trtVal: treatment?.metrics.recallAtK },
    { label: 'NDCG@K', ctrlVal: control.metrics.ndcgAtK, trtVal: treatment?.metrics.ndcgAtK },
    { label: 'MRR', ctrlVal: control.metrics.mrr, trtVal: treatment?.metrics.mrr },
    { label: 'Sample Size', ctrlVal: control.metrics.sampleSize, trtVal: treatment?.metrics.sampleSize },
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      {winner && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.375rem 0.75rem', background: '#f0fdf4',
          border: '1px solid #bbf7d0', borderRadius: '9999px',
          fontSize: '0.8125rem', fontWeight: 600, color: '#15803d',
          marginBottom: '0.875rem',
        }}>
          Winner: {winner}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: '0.625rem 0.75rem',
                  textAlign: h === 'Metric' ? 'left' : 'right',
                  borderBottom: '2px solid #e2e8f0',
                  color: '#64748b',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, ctrlVal, trtVal }) => (
            <tr key={label} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '0.625rem 0.75rem', fontWeight: 500, color: '#374151' }}>
                {label}
              </td>
              <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#111827' }}>
                {label === 'Sample Size' ? ctrlVal.toLocaleString() : pct(ctrlVal)}
              </td>
              {treatment && (
                <>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right', fontFamily: 'monospace', color: '#111827' }}>
                    {label === 'Sample Size' ? (trtVal ?? 0).toLocaleString() : pct(trtVal ?? 0)}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'right' }}>
                    {label !== 'Sample Size' ? delta(ctrlVal, trtVal ?? 0) : '—'}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
