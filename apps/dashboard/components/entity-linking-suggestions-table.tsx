'use client';

type LinkSuggestion = {
  id: string;
  entityIdA: string;
  connectorA: string;
  entityIdB: string;
  connectorB: string;
  confidence: number;
  matchSignals: Record<string, unknown> | null;
  status: 'proposed' | 'confirmed' | 'rejected';
};

type EntityLinkingSuggestionsTableProps = {
  suggestions: LinkSuggestion[];
  onMerge: (suggestion: LinkSuggestion) => void;
  onReject: (id: string) => void;
  merging: string | null;
};

/**
 * Paginated table of cross-connector entity link suggestions.
 * Shows confidence, connector info, and match signals with merge/reject actions.
 */
export function EntityLinkingSuggestionsTable({
  suggestions,
  onMerge,
  onReject,
  merging,
}: EntityLinkingSuggestionsTableProps) {
  if (suggestions.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', border: '2px dashed #e5e7eb', borderRadius: 10, color: '#9ca3af', fontSize: 14 }}>
        No duplicate entities detected. Run analysis to scan for cross-connector duplicates.
      </div>
    );
  }

  const confidenceColor = (score: number) =>
    score >= 0.85 ? '#16a34a' : score >= 0.7 ? '#d97706' : '#dc2626';

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
          <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Entity A</th>
          <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Entity B</th>
          <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Confidence</th>
          <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Signals</th>
          <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {suggestions.map((s, i) => (
          <tr key={s.id} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
            <td style={{ padding: '8px 12px' }}>
              <div style={{ fontWeight: 600 }}>{s.entityIdA}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.connectorA}</div>
            </td>
            <td style={{ padding: '8px 12px' }}>
              <div style={{ fontWeight: 600 }}>{s.entityIdB}</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.connectorB}</div>
            </td>
            <td style={{ padding: '8px 12px' }}>
              <span style={{ fontWeight: 700, color: confidenceColor(s.confidence) }}>
                {(s.confidence * 100).toFixed(0)}%
              </span>
            </td>
            <td style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280' }}>
              {s.matchSignals
                ? Object.entries(s.matchSignals)
                    .filter(([k, v]) => k !== 'compositeScore' && v)
                    .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase())
                    .join(', ')
                : '—'}
            </td>
            <td style={{ padding: '8px 12px' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => onMerge(s)}
                  disabled={merging === s.id}
                  style={{
                    padding: '3px 10px', background: merging === s.id ? '#9ca3af' : '#2563eb',
                    color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {merging === s.id ? '…' : 'Merge'}
                </button>
                <button
                  onClick={() => onReject(s.id)}
                  style={{ padding: '3px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff' }}
                >
                  Reject
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
