'use client';

import { useState, useCallback } from 'react';
import { LineageFlowDiagram } from '../../../components/lineage-flow-diagram.js';
import { ImpactVisualizer } from '../../../components/impact-visualizer.js';

type LineageRecord = {
  entityId: string;
  sourceConnectorId: string;
  transformations: Array<{ type: string; timestamp: string }>;
  lastModifiedAt: string;
  lastModifiedBy: string;
};

type LineageGraph = {
  entityId: string;
  ancestors: Array<{ entityId: string; depth: number; relationshipType: string }>;
  descendants: Array<{ entityId: string; depth: number; relationshipType: string }>;
};

type ImpactResult = {
  entityId: string;
  affectedEntityIds: string[];
  depth: number;
  affectedCount: number;
  changeType?: string;
};

type Tab = 'lineage' | 'graph' | 'impact';

/**
 * Data lineage admin page: view entity provenance, lineage graph, and change impact analysis.
 */
export default function DataLineagePage() {
  const [tab, setTab] = useState<Tab>('lineage');
  const [entityId, setEntityId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineage, setLineage] = useState<LineageRecord | null>(null);
  const [graph, setGraph] = useState<LineageGraph | null>(null);
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [changeType, setChangeType] = useState<'update' | 'delete' | 'retype'>('update');

  const API_BASE = '/api/v1';

  const loadLineage = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setError(null); setLineage(null);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(id)}/lineage`);
      const json = await res.json() as { data?: LineageRecord; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Not found');
      setLineage(json.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load lineage'); }
    finally { setLoading(false); }
  }, []);

  const loadGraph = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setError(null); setGraph(null);
    try {
      const res = await fetch(`${API_BASE}/entities/${encodeURIComponent(id)}/lineage-graph`);
      const json = await res.json() as { data?: LineageGraph; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed');
      setGraph(json.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load graph'); }
    finally { setLoading(false); }
  }, []);

  const loadImpact = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setError(null); setImpact(null);
    try {
      const res = await fetch(`${API_BASE}/lineage/change-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId: id, changeType, maxDepth: 5 }),
      });
      const json = await res.json() as { data?: ImpactResult; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed');
      setImpact(json.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to compute impact'); }
    finally { setLoading(false); }
  }, [changeType]);

  const handleSearch = () => {
    if (!entityId.trim()) { setError('Enter an entity ID'); return; }
    if (tab === 'lineage') void loadLineage(entityId.trim());
    else if (tab === 'graph') void loadGraph(entityId.trim());
    else void loadImpact(entityId.trim());
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Data Lineage</h1>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Trace entity provenance, transformation history, and change impact.</p>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={entityId}
          onChange={e => setEntityId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Enter entity ID (e.g. hubspot:contact:123)…"
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
        {tab === 'impact' && (
          <select value={changeType} onChange={e => setChangeType(e.target.value as typeof changeType)}
            style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
            <option value='update'>Update</option>
            <option value='delete'>Delete</option>
            <option value='retype'>Retype</option>
          </select>
        )}
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{ padding: '8px 18px', background: loading ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? 'Loading…' : 'Analyze'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
        {([
          ['lineage', 'Provenance'],
          ['graph', 'Lineage Graph'],
          ['impact', 'Change Impact'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 18px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', color: tab === t ? '#2563eb' : '#6b7280', fontWeight: tab === t ? 700 : 400, fontSize: 14, cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {/* Provenance tab */}
      {tab === 'lineage' && (
        lineage ? (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{lineage.entityId}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Source: <strong>{lineage.sourceConnectorId}</strong> · Modified by: {lineage.lastModifiedBy}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Transformation History</div>
              {lineage.transformations.length === 0 ? (
                <div style={{ color: '#9ca3af', fontSize: 13 }}>No transformations recorded.</div>
              ) : (
                <div>
                  {lineage.transformations.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                      <span style={{ padding: '2px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>{t.type}</span>
                      <span style={{ color: '#6b7280', fontSize: 11 }}>{new Date(t.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : !loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
            Enter an entity ID to view its provenance.
          </div>
        ) : null
      )}

      {/* Graph tab */}
      {tab === 'graph' && (
        graph ? (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
            <LineageFlowDiagram
              entityId={graph.entityId}
              ancestors={graph.ancestors}
              descendants={graph.descendants}
            />
          </div>
        ) : !loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
            Enter an entity ID to visualize its lineage graph.
          </div>
        ) : null
      )}

      {/* Impact tab */}
      {tab === 'impact' && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 20 }}>
          <ImpactVisualizer impact={impact} loading={loading} />
        </div>
      )}
    </div>
  );
}
