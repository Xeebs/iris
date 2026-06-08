'use client';

import { useState, useEffect } from 'react';

type TransformationEntry = {
  type: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

type LineageRecord = {
  entityId: string;
  workspaceId: string;
  sourceConnectorId: string;
  transformations: TransformationEntry[];
  lastModifiedBy: string;
  lastModifiedAt: string;
};

type Props = {
  workspaceId: string;
  entityId: string;
};

const TRANSFORM_COLOR: Record<string, string> = {
  embedding: '#6366f1',
  enrichment: '#0ea5e9',
  deduplication: '#10b981',
  normalization: '#f59e0b',
};

function TransformNode({ entry, index }: { entry: TransformationEntry; index: number }) {
  const color = TRANSFORM_COLOR[entry.type] ?? '#6b7280';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {index > 0 && (
        <div style={{ width: 32, height: 2, background: '#e5e7eb', flexShrink: 0 }} />
      )}
      <div
        style={{
          border: `2px solid ${color}`,
          borderRadius: 8,
          padding: '6px 12px',
          background: `${color}18`,
          fontSize: 13,
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{ color, fontWeight: 600 }}>{entry.type}</div>
        <div style={{ color: '#6b7280', fontSize: 11 }}>
          {new Date(entry.timestamp).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

/**
 * Visualizes the transformation chain for a single entity's lineage.
 *
 * @param workspaceId - Workspace scope
 * @param entityId - Entity to inspect
 */
export function LineageGraphViewer({ workspaceId, entityId }: Props) {
  const [record, setRecord] = useState<LineageRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/v1/lineage/${encodeURIComponent(entityId)}`, {
      headers: { 'x-workspace-id': workspaceId },
    })
      .then(async (res) => {
        if (res.status === 404) { setRecord(null); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { data: LineageRecord };
        setRecord(json.data);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [workspaceId, entityId]);

  if (loading) return <div style={{ color: '#6b7280', padding: 16 }}>Loading lineage…</div>;
  if (error) return <div style={{ color: '#ef4444', padding: 16 }}>Error: {error}</div>;
  if (!record) return (
    <div style={{ padding: 16, color: '#6b7280' }}>
      No lineage recorded for <code>{entityId}</code>. Data will appear after the next sync.
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Source connector: </span>
        <span style={{ fontSize: 14, color: '#6366f1' }}>{record.sourceConnectorId}</span>
        <span style={{ marginLeft: 16, fontSize: 13, color: '#6b7280' }}>
          Last modified: {new Date(record.lastModifiedAt).toLocaleString()} by {record.lastModifiedBy}
        </span>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 'max-content' }}>
          <div
            style={{
              border: '2px solid #10b981',
              borderRadius: 8,
              padding: '6px 12px',
              background: '#10b98118',
              fontSize: 13,
              marginRight: 8,
            }}
          >
            <div style={{ color: '#10b981', fontWeight: 600 }}>Origin</div>
            <div style={{ color: '#6b7280', fontSize: 11 }}>{record.sourceConnectorId}</div>
          </div>
          {record.transformations.map((t, i) => (
            <TransformNode key={i} entry={t} index={i + 1} />
          ))}
        </div>
      </div>

      {record.transformations.length === 0 && (
        <div style={{ color: '#6b7280', fontSize: 13, marginTop: 8 }}>
          No transformations recorded — entity was ingested without post-processing.
        </div>
      )}
    </div>
  );
}
