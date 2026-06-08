'use client';

import { useState, useEffect, useCallback } from 'react';
import { EntityLinkingSuggestionsTable } from '../../../components/entity-linking-suggestions-table.js';

type LinkSuggestion = {
  id: string;
  entityIdA: string;
  connectorA: string;
  entityIdB: string;
  connectorB: string;
  confidence: number;
  matchSignals: Record<string, unknown> | null;
  status: 'proposed' | 'confirmed' | 'rejected';
};

type MergeRecord = {
  mergeId: string;
  sourceEntityId: string;
  targetEntityId: string;
  mergedBy: string;
  mergedAt: string;
  undoneAt: string | null;
};

/**
 * Admin page for cross-connector entity linking and merge management.
 * Allows analyzing for duplicates, confirming merges, and reviewing history.
 */
export default function EntityLinkingPage() {
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [history, setHistory] = useState<MergeRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'history'>('suggestions');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const API_BASE = '/api/v1/entity-linking';

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/suggestions`);
      const json = await res.json() as { data?: LinkSuggestion[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load');
      setSuggestions(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/history`);
      const json = await res.json() as { data?: MergeRecord[] };
      setHistory(json.data ?? []);
    } catch {
      setError('Failed to load history');
    }
  }, []);

  useEffect(() => { void loadSuggestions(); }, [loadSuggestions]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/analyze`, { method: 'POST' });
      const json = await res.json() as { data?: { proposalsCreated: number }; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Analysis failed');
      await loadSuggestions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMerge = async (suggestion: LinkSuggestion) => {
    setMerging(suggestion.id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceEntityId: suggestion.entityIdA,
          targetEntityId: suggestion.entityIdB,
          mergedBy: 'dashboard-user',
        }),
      });
      if (!res.ok) throw new Error('Merge failed');
      await loadSuggestions();
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setMerging(null);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await fetch(`/api/v1/entity-linking/links/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      setSuggestions(prev => prev.filter(s => s.id !== id));
    } catch {
      setError('Reject failed');
    }
  };

  const handleUndoMerge = async (mergeId: string) => {
    try {
      await fetch(`${API_BASE}/merges/${mergeId}`, { method: 'DELETE' });
      await loadHistory();
    } catch {
      setError('Undo failed');
    }
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Entity Linking</h1>
          <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
            Detect and merge duplicate entities across different connectors.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { void loadSuggestions(); void loadHistory(); }}
            disabled={loading}
            style={{ padding: '7px 14px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff', cursor: 'pointer' }}
          >
            Refresh
          </button>
          <button
            onClick={() => void runAnalysis()}
            disabled={analyzing}
            style={{ padding: '7px 16px', background: analyzing ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: analyzing ? 'not-allowed' : 'pointer' }}
          >
            {analyzing ? 'Analyzing…' : 'Run Analysis'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <div style={{ flex: 1, padding: '10px 14px', background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>{suggestions.length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Pending Suggestions</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{history.filter(m => !m.undoneAt).length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Active Merges</div>
        </div>
        <div style={{ flex: 1, padding: '10px 14px', background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#c2410c' }}>{history.filter(m => m.undoneAt).length}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Undone Merges</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
        {(['suggestions', 'history'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); if (tab === 'history') void loadHistory(); }}
            style={{
              padding: '8px 20px', background: 'none', border: 'none',
              borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === tab ? '#2563eb' : '#6b7280',
              fontWeight: activeTab === tab ? 700 : 400,
              fontSize: 14, cursor: 'pointer',
            }}
          >
            {tab === 'suggestions' ? `Suggestions (${suggestions.length})` : `Merge History (${history.length})`}
          </button>
        ))}
      </div>

      {activeTab === 'suggestions' && (
        loading ? <p style={{ color: '#9ca3af' }}>Loading…</p> : (
          <EntityLinkingSuggestionsTable
            suggestions={suggestions}
            onMerge={(s) => void handleMerge(s)}
            onReject={(id) => void handleReject(id)}
            merging={merging}
          />
        )
      )}

      {activeTab === 'history' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Source → Target</th>
              <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Merged By</th>
              <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Date</th>
              <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '8px 12px', color: '#6b7280', fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {history.map((m, i) => (
              <tr key={m.mergeId} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa', opacity: m.undoneAt ? 0.6 : 1 }}>
                <td style={{ padding: '8px 12px', fontSize: 12, fontFamily: 'monospace' }}>
                  {m.sourceEntityId} → {m.targetEntityId}
                </td>
                <td style={{ padding: '8px 12px' }}>{m.mergedBy}</td>
                <td style={{ padding: '8px 12px', color: '#6b7280' }}>{new Date(m.mergedAt).toLocaleDateString()}</td>
                <td style={{ padding: '8px 12px' }}>
                  {m.undoneAt ? (
                    <span style={{ color: '#9ca3af', fontSize: 12 }}>Undone</span>
                  ) : (
                    <span style={{ color: '#16a34a', fontSize: 12, fontWeight: 600 }}>Active</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {!m.undoneAt && (
                    <button
                      onClick={() => void handleUndoMerge(m.mergeId)}
                      style={{ padding: '3px 10px', border: '1px solid #fca5a5', borderRadius: 4, fontSize: 11, cursor: 'pointer', color: '#dc2626', background: '#fff' }}
                    >
                      Undo
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
