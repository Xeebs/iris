'use client';

import { useState, useCallback } from 'react';
import { EntityTypeSuggester } from './entity-type-suggester.js';
import { RelationshipMapper } from './relationship-mapper.js';

type EntityTypeSuggestion = {
  suggestionId: string | undefined;
  entityType: string;
  sampleCount: number;
  fields: { fieldName: string; inferredType: string; nullRate: number; exampleValues: string[] }[];
  confidence: 'high' | 'medium' | 'low';
  confirmed: boolean;
};

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

type Tab = 'entity-types' | 'relationships';

type SchemaDiscoveryWizardProps = {
  connectorId: string;
  apiBase?: string;
};

/**
 * Multi-step schema discovery wizard with entity type and relationship confirmation.
 * Step 1: Trigger discovery
 * Step 2: Review entity types
 * Step 3: Review relationships
 */
export function SchemaDiscoveryWizard({ connectorId, apiBase = '/api/v1' }: SchemaDiscoveryWizardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('entity-types');
  const [entityTypes, setEntityTypes] = useState<EntityTypeSuggestion[]>([]);
  const [relationships, setRelationships] = useState<RelationshipSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverageScore, setCoverageScore] = useState<number | null>(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/connectors/${encodeURIComponent(connectorId)}/schema-suggestions`);
      const json = await res.json() as { data?: { entityTypes: EntityTypeSuggestion[]; relationships: RelationshipSuggestion[] }; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load suggestions');
      setEntityTypes(json.data?.entityTypes ?? []);
      setRelationships(json.data?.relationships ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [connectorId, apiBase]);

  const runDiscovery = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/connectors/${encodeURIComponent(connectorId)}/discover-schema`, {
        method: 'POST',
      });
      const json = await res.json() as { data?: { coverageScore: number }; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Discovery failed');
      setCoverageScore(json.data?.coverageScore ?? null);
      await loadSuggestions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  const confirmSuggestion = async (suggestionId: string, type: 'entity_type' | 'relationship') => {
    setConfirming(suggestionId);
    try {
      await fetch(`${apiBase}/connectors/suggestions/${suggestionId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      await loadSuggestions();
    } catch {
      setError('Confirmation failed');
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Schema Discovery Wizard</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{connectorId}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {coverageScore !== null && (
            <span style={{ fontSize: 13, color: '#374151' }}>
              Coverage: <strong>{(coverageScore * 100).toFixed(0)}%</strong>
            </span>
          )}
          <button
            onClick={() => void runDiscovery()}
            disabled={discovering}
            style={{
              padding: '7px 16px',
              background: discovering ? '#9ca3af' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              cursor: discovering ? 'not-allowed' : 'pointer',
            }}
          >
            {discovering ? 'Discovering…' : 'Run Discovery'}
          </button>
          <button
            onClick={() => void loadSuggestions()}
            disabled={loading}
            style={{
              padding: '7px 14px',
              background: '#fff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, padding: '10px 14px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>{entityTypes.length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Entity Types Discovered</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{entityTypes.filter(t => t.confirmed).length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Entity Types Confirmed</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#c2410c' }}>{relationships.length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Relationships Detected</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: '#faf5ff', borderRadius: 8, border: '1px solid #e9d5ff' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#7c3aed' }}>{relationships.filter(r => r.confirmed).length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Relationships Confirmed</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        {(['entity-types', 'relationships'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === tab ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === tab ? 700 : 400,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {tab === 'entity-types' ? `Entity Types (${entityTypes.length})` : `Relationships (${relationships.length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'entity-types' && (
        loading ? (
          <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</p>
        ) : (
          <EntityTypeSuggester
            suggestions={entityTypes}
            onConfirm={id => void confirmSuggestion(id, 'entity_type')}
            confirming={confirming}
          />
        )
      )}

      {activeTab === 'relationships' && (
        loading ? (
          <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</p>
        ) : (
          <RelationshipMapper
            relationships={relationships}
            onConfirm={id => void confirmSuggestion(id, 'relationship')}
            confirming={confirming}
          />
        )
      )}
    </div>
  );
}
