'use client';

type EntityData = {
  entityId: string;
  connectorId: string;
  label: string;
  attributes: Record<string, unknown>;
};

type EntityMergePreviewProps = {
  source: EntityData;
  target: EntityData;
  confidenceScore: number;
  signals: string[];
  onConfirm: () => void;
  onReject: () => void;
  confirming?: boolean;
};

const SIGNAL_LABEL: Record<string, string> = {
  name_similarity: 'Name Match',
  email_domain: 'Email Domain',
  attribute_overlap: 'Attribute Overlap',
  semantic_similarity: 'Semantic Match',
};

/**
 * Side-by-side entity comparison for merge confirmation.
 * Shows attribute differences and match signals.
 */
export function EntityMergePreview({
  source, target, confidenceScore, signals, onConfirm, onReject, confirming = false,
}: EntityMergePreviewProps) {
  const allKeys = [...new Set([...Object.keys(source.attributes), ...Object.keys(target.attributes)])];
  const diffKeys = allKeys.filter(k => source.attributes[k] !== target.attributes[k]);
  const sameKeys = allKeys.filter(k => source.attributes[k] === target.attributes[k]);

  const confidenceColor = confidenceScore >= 0.85 ? '#16a34a' : confidenceScore >= 0.7 ? '#d97706' : '#dc2626';

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: '#f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Potential Duplicate</div>
          <span style={{ padding: '2px 8px', borderRadius: 12, background: '#fff', border: `1px solid ${confidenceColor}`, fontSize: 12, fontWeight: 700, color: confidenceColor }}>
            {(confidenceScore * 100).toFixed(0)}% confidence
          </span>
          {signals.map(s => (
            <span key={s} style={{ padding: '2px 8px', borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 11, color: '#1d4ed8' }}>
              {SIGNAL_LABEL[s] ?? s}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onReject}
            disabled={confirming}
            style={{ padding: '5px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#fff', color: '#374151' }}
          >
            Reject
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            style={{ padding: '5px 14px', background: confirming ? '#9ca3af' : '#2563eb', border: 'none', borderRadius: 6, fontSize: 13, cursor: confirming ? 'not-allowed' : 'pointer', color: '#fff' }}
          >
            {confirming ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {[source, target].map((entity, col) => (
          <div key={entity.entityId} style={{ padding: 16, borderRight: col === 0 ? '1px solid #e5e7eb' : 'none' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{entity.label}</div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
              {entity.entityId} · {entity.connectorId}
            </div>

            {/* Different attributes */}
            {diffKeys.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  Different
                </div>
                {diffKeys.map(k => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 4, background: '#fef2f2', borderRadius: 4, fontSize: 12 }}>
                    <span style={{ color: '#6b7280' }}>{k}</span>
                    <span style={{ fontWeight: 500 }}>{String(entity.attributes[k] ?? '—')}</span>
                  </div>
                ))}
              </>
            )}

            {/* Same attributes */}
            {sameKeys.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, marginTop: diffKeys.length > 0 ? 10 : 0 }}>
                  Matching
                </div>
                {sameKeys.slice(0, 5).map(k => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 4, background: '#f0fdf4', borderRadius: 4, fontSize: 12 }}>
                    <span style={{ color: '#6b7280' }}>{k}</span>
                    <span style={{ fontWeight: 500 }}>{String(entity.attributes[k] ?? '—')}</span>
                  </div>
                ))}
                {sameKeys.length > 5 && (
                  <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 8px' }}>+{sameKeys.length - 5} more matching</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
