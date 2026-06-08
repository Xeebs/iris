'use client';

type EntityAttributes = Record<string, string | number | boolean | null | undefined>;

type EntitySnapshot = {
  id: string;
  type: string;
  label: string;
  attributes: EntityAttributes;
  sourceConnectorId?: string;
};

type Props = {
  entityA: EntitySnapshot;
  entityB: EntitySnapshot;
  similarityScore: number;
};

/**
 * Side-by-side attribute comparison for a potential duplicate entity pair.
 *
 * @param entityA - First entity
 * @param entityB - Candidate duplicate
 * @param similarityScore - Cosine similarity between the pair
 */
export function EntityPairComparison({ entityA, entityB, similarityScore }: Props) {
  const allKeys = Array.from(
    new Set([...Object.keys(entityA.attributes), ...Object.keys(entityB.attributes)]),
  );

  const pct = Math.round(similarityScore * 100);

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>Similarity: {pct}%</span>
        <div
          style={{
            height: 6,
            width: 160,
            background: '#e5e7eb',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: pct >= 85 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981',
              borderRadius: 3,
            }}
          />
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500, width: '20%' }}>Field</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500, width: '40%' }}>
              {entityA.label} <span style={{ fontSize: 11, color: '#9ca3af' }}>({entityA.type})</span>
            </th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500, width: '40%' }}>
              {entityB.label} <span style={{ fontSize: 11, color: '#9ca3af' }}>({entityB.type})</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
            <td style={{ padding: '5px 8px', color: '#6b7280' }}>ID</td>
            <td style={{ padding: '5px 8px' }}><code style={{ fontSize: 11 }}>{entityA.id}</code></td>
            <td style={{ padding: '5px 8px' }}><code style={{ fontSize: 11 }}>{entityB.id}</code></td>
          </tr>
          {entityA.sourceConnectorId !== undefined && (
            <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '5px 8px', color: '#6b7280' }}>Source</td>
              <td style={{ padding: '5px 8px' }}>{entityA.sourceConnectorId ?? '—'}</td>
              <td style={{ padding: '5px 8px' }}>{entityB.sourceConnectorId ?? '—'}</td>
            </tr>
          )}
          {allKeys.map((key) => {
            const aVal = entityA.attributes[key];
            const bVal = entityB.attributes[key];
            const differ = String(aVal ?? '') !== String(bVal ?? '');
            return (
              <tr
                key={key}
                style={{
                  borderBottom: '1px solid #f3f4f6',
                  background: differ ? '#fffbeb' : 'transparent',
                }}
              >
                <td style={{ padding: '5px 8px', color: '#6b7280' }}>{key}</td>
                <td style={{ padding: '5px 8px', color: differ ? '#92400e' : 'inherit' }}>
                  {aVal !== undefined && aVal !== null ? String(aVal) : <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
                <td style={{ padding: '5px 8px', color: differ ? '#92400e' : 'inherit' }}>
                  {bVal !== undefined && bVal !== null ? String(bVal) : <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
