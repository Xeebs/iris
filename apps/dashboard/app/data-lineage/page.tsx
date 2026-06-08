'use client';

import { useState, useEffect } from 'react';
import { LineageGraphViewer } from '../../components/lineage-graph-viewer';
import { ImpactAnalysisTool } from '../../components/impact-analysis-tool';

type LineageRecord = {
  entityId: string;
  sourceConnectorId: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
};

type ListResponse = {
  data: LineageRecord[];
  meta: { hasMore: boolean; nextCursor: string | null };
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default';

type ActiveTab = 'browse' | 'impact';

export default function DataLineagePage() {
  const [records, setRecords] = useState<LineageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('browse');

  useEffect(() => {
    fetch('/api/v1/lineage', { headers: { 'x-workspace-id': WORKSPACE_ID } })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json() as ListResponse;
        setRecords(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const tabStyle = (tab: ActiveTab) => ({
    padding: '8px 16px',
    border: 'none',
    borderBottom: activeTab === tab ? '2px solid #6366f1' : '2px solid transparent',
    background: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: activeTab === tab ? 600 : 400,
    color: activeTab === tab ? '#6366f1' : '#6b7280',
  });

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Data Lineage</h1>
      <p style={{ color: '#6b7280', marginBottom: 24, fontSize: 14 }}>
        Track the origin and transformation chain for indexed entities, and analyse downstream impact.
      </p>

      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
        <button style={tabStyle('browse')} onClick={() => setActiveTab('browse')}>Browse Lineage</button>
        <button style={tabStyle('impact')} onClick={() => setActiveTab('impact')}>Impact Analysis</button>
      </div>

      {activeTab === 'browse' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 13, background: '#f9fafb' }}>
              Entities ({records.length})
            </div>
            {loading ? (
              <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Loading…</div>
            ) : records.length === 0 ? (
              <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>
                No lineage records found. Run a connector sync to populate this view.
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', maxHeight: 500 }}>
                {records.map((r) => (
                  <li
                    key={r.entityId}
                    onClick={() => setSelectedEntityId(r.entityId)}
                    style={{
                      padding: '10px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f3f4f6',
                      background: selectedEntityId === r.entityId ? '#eef2ff' : 'transparent',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{r.entityId}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                      {r.sourceConnectorId} · {new Date(r.lastModifiedAt).toLocaleDateString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 13, background: '#f9fafb' }}>
              Lineage Graph
            </div>
            {selectedEntityId ? (
              <LineageGraphViewer workspaceId={WORKSPACE_ID} entityId={selectedEntityId} />
            ) : (
              <div style={{ padding: 24, color: '#6b7280', fontSize: 13 }}>
                Select an entity on the left to view its transformation chain.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'impact' && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 13, background: '#f9fafb' }}>
            Run Impact Analysis
          </div>
          <ImpactAnalysisTool workspaceId={WORKSPACE_ID} initialEntityId={selectedEntityId ?? ''} />
        </div>
      )}
    </div>
  );
}
