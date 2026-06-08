'use client';

type FieldSuggestion = {
  fieldName: string;
  inferredType: string;
  nullRate: number;
  exampleValues: string[];
};

type EntityTypeSuggestion = {
  suggestionId: string | undefined;
  entityType: string;
  sampleCount: number;
  fields: FieldSuggestion[];
  confidence: 'high' | 'medium' | 'low';
  confirmed: boolean;
};

const CONFIDENCE_COLOR = {
  high: '#16a34a',
  medium: '#d97706',
  low: '#9ca3af',
};

type EntityTypeSuggesterProps = {
  suggestions: EntityTypeSuggestion[];
  onConfirm: (suggestionId: string) => void;
  confirming: string | null;
};

/**
 * Entity type suggestion list with confirm actions.
 * Shows each discovered entity type with its fields and confidence badge.
 */
export function EntityTypeSuggester({ suggestions, onConfirm, confirming }: EntityTypeSuggesterProps) {
  if (suggestions.length === 0) {
    return <p style={{ color: '#6b7280', fontSize: 14 }}>No entity type suggestions yet.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {suggestions.map(s => (
        <div
          key={s.entityType}
          style={{
            padding: '12px 16px',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            background: s.confirmed ? '#f0fdf4' : '#fff',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{s.entityType}</span>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  color: CONFIDENCE_COLOR[s.confidence],
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                {s.confidence}
              </span>
              <span style={{ marginLeft: 8, fontSize: 12, color: '#9ca3af' }}>
                {s.sampleCount} samples · {s.fields.length} fields
              </span>
            </div>
            {s.confirmed ? (
              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Confirmed</span>
            ) : (
              <button
                onClick={() => s.suggestionId && onConfirm(s.suggestionId)}
                disabled={confirming === s.suggestionId}
                style={{
                  padding: '4px 12px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: 12,
                  cursor: s.suggestionId ? 'pointer' : 'not-allowed',
                  opacity: confirming === s.suggestionId ? 0.7 : 1,
                }}
              >
                {confirming === s.suggestionId ? 'Confirming…' : 'Confirm'}
              </button>
            )}
          </div>

          {s.fields.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {s.fields.slice(0, 10).map(f => (
                <span
                  key={f.fieldName}
                  style={{
                    padding: '2px 8px',
                    background: '#f3f4f6',
                    borderRadius: 4,
                    fontSize: 11,
                    color: '#374151',
                  }}
                  title={`Type: ${f.inferredType}, Null rate: ${(f.nullRate * 100).toFixed(0)}%`}
                >
                  {f.fieldName}
                  <span style={{ color: '#9ca3af', marginLeft: 3 }}>{f.inferredType[0]}</span>
                </span>
              ))}
              {s.fields.length > 10 && (
                <span style={{ padding: '2px 8px', color: '#9ca3af', fontSize: 11 }}>
                  +{s.fields.length - 10} more
                </span>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
