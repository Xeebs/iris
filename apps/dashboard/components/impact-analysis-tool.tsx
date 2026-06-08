'use client';

import { useState } from 'react';

type AffectedEntity = {
  entityId: string;
  entityType: string;
  label: string;
  relationshipType: string;
};

type ImpactResult = {
  entityId: string;
  affectedEntityCount: number;
  affectedEntities: AffectedEntity[];
};

type Props = {
  workspaceId: string;
  initialEntityId?: string;
};

/**
 * Lets users select an entity ID and run impact analysis to find downstream dependents.
 *
 * @param workspaceId - Workspace scope
 * @param initialEntityId - Optional pre-filled entity ID
 */
export function ImpactAnalysisTool({ workspaceId, initialEntityId = '' }: Props) {
  const [entityId, setEntityId] = useState(initialEntityId);
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAnalysis() {
    if (!entityId.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/lineage/${encodeURIComponent(entityId.trim())}/impact-analysis`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: ImpactResult };
      setResult(json.data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          placeholder="Entity ID (e.g. hubspot:deal:123)"
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            fontSize: 13,
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') void runAnalysis(); }}
        />
        <button
          onClick={() => void runAnalysis()}
          disabled={loading || !entityId.trim()}
          style={{
            padding: '8px 16px',
            background: loading ? '#e5e7eb' : '#6366f1',
            color: loading ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Analyzing…' : 'Run Analysis'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 13, marginBottom: 12 }}>Error: {error}</div>
      )}

      {result && (
        <div>
          <div style={{ marginBottom: 12, fontSize: 14 }}>
            <span style={{ fontWeight: 600 }}>{result.affectedEntityCount}</span> entities affected by changes to{' '}
            <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>{result.entityId}</code>
          </div>

          {result.affectedEntities.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 13 }}>
              No downstream entities found — this entity is a leaf node in the relationship graph.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Entity ID</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Label</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Relationship</th>
                </tr>
              </thead>
              <tbody>
                {result.affectedEntities.map((e) => (
                  <tr key={e.entityId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <code style={{ fontSize: 11 }}>{e.entityId}</code>
                    </td>
                    <td style={{ padding: '6px 8px', color: '#6366f1' }}>{e.entityType}</td>
                    <td style={{ padding: '6px 8px' }}>{e.label}</td>
                    <td style={{ padding: '6px 8px', color: '#6b7280' }}>{e.relationshipType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
