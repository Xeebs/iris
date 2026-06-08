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
  survivingEntity: EntitySnapshot;
  mergedEntity: EntitySnapshot;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

/**
 * Preview of the entity that will result from a merge, before the user confirms.
 * Attributes from the surviving entity take precedence; gaps are filled from the merged entity.
 *
 * @param survivingEntity - Entity that will be kept after merge
 * @param mergedEntity - Entity that will be absorbed
 * @param onConfirm - Called when user confirms the merge
 * @param onCancel - Called when user cancels
 * @param loading - Disables confirm button while request is in-flight
 */
export function MergePreview({ survivingEntity, mergedEntity, onConfirm, onCancel, loading = false }: Props) {
  const mergedAttributes: EntityAttributes = {
    ...mergedEntity.attributes,
    ...survivingEntity.attributes,
  };
  const allKeys = Object.keys(mergedAttributes);

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ marginBottom: 12, padding: '8px 12px', background: '#eff6ff', borderRadius: 6, borderLeft: '3px solid #3b82f6' }}>
        <strong>After merge:</strong>{' '}
        <code style={{ fontSize: 11 }}>{survivingEntity.id}</code> will be kept.{' '}
        <code style={{ fontSize: 11 }}>{mergedEntity.id}</code> will be marked as merged.
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500, width: '25%' }}>Field</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Merged result</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500, width: '15%' }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {allKeys.map((key) => {
            const fromSurviving = survivingEntity.attributes[key] !== undefined && survivingEntity.attributes[key] !== null;
            const val = mergedAttributes[key];
            return (
              <tr key={key} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '5px 8px', color: '#6b7280' }}>{key}</td>
                <td style={{ padding: '5px 8px' }}>
                  {val !== undefined && val !== null ? String(val) : <span style={{ color: '#d1d5db' }}>—</span>}
                </td>
                <td style={{ padding: '5px 8px' }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 9999,
                      background: fromSurviving ? '#dcfce7' : '#f3f4f6',
                      color: fromSurviving ? '#15803d' : '#6b7280',
                    }}
                  >
                    {fromSurviving ? 'surviving' : 'merged'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          disabled={loading}
          style={{
            padding: '7px 16px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            background: '#fff',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          style={{
            padding: '7px 16px',
            border: 'none',
            borderRadius: 6,
            background: loading ? '#e5e7eb' : '#dc2626',
            color: loading ? '#9ca3af' : '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {loading ? 'Merging…' : 'Confirm Merge'}
        </button>
      </div>
    </div>
  );
}
