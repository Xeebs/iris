'use client';

type RelationshipSuggestion = {
  suggestionId: string | undefined;
  fromEntityType: string;
  toEntityType: string;
  viaField: string;
  relationshipType: string;
  confidence: 'high' | 'medium' | 'low';
  heuristic: string;
  confirmed: boolean;
};

const HEURISTIC_DESC: Record<string, string> = {
  fk_pattern: 'FK pattern',
  id_suffix: 'ID suffix',
  name_similarity: 'Name similarity',
};

const CONFIDENCE_COLOR = {
  high: '#16a34a',
  medium: '#d97706',
  low: '#9ca3af',
};

type RelationshipMapperProps = {
  relationships: RelationshipSuggestion[];
  onConfirm: (suggestionId: string) => void;
  confirming: string | null;
};

/**
 * Visual relationship mapping table with confirm actions.
 * Shows detected entity relationships sorted by confidence.
 */
export function RelationshipMapper({ relationships, onConfirm, confirming }: RelationshipMapperProps) {
  if (relationships.length === 0) {
    return <p style={{ color: '#6b7280', fontSize: 14 }}>No relationship suggestions yet.</p>;
  }

  const sorted = [...relationships].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>From</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>→</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>To</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Via Field</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Type</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Heuristic</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Confidence</th>
            <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={`${r.fromEntityType}:${r.toEntityType}:${r.viaField}`}
              style={{
                background: i % 2 === 0 ? '#fff' : '#fafafa',
                opacity: r.confirmed ? 0.7 : 1,
              }}
            >
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.fromEntityType}</td>
              <td style={{ padding: '8px 12px', color: '#9ca3af' }}>{r.relationshipType.replace('_', ' ')}</td>
              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{r.toEntityType}</td>
              <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#374151' }}>{r.viaField}</td>
              <td style={{ padding: '8px 12px' }}>{r.relationshipType}</td>
              <td style={{ padding: '8px 12px', color: '#6b7280' }}>
                {HEURISTIC_DESC[r.heuristic] ?? r.heuristic}
              </td>
              <td style={{ padding: '8px 12px' }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    color: CONFIDENCE_COLOR[r.confidence],
                  }}
                >
                  {r.confidence}
                </span>
              </td>
              <td style={{ padding: '8px 12px' }}>
                {r.confirmed ? (
                  <span style={{ color: '#16a34a', fontSize: 12 }}>✓</span>
                ) : (
                  <button
                    onClick={() => r.suggestionId && onConfirm(r.suggestionId)}
                    disabled={confirming === r.suggestionId}
                    style={{
                      padding: '3px 8px',
                      background: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {confirming === r.suggestionId ? '…' : 'Confirm'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
