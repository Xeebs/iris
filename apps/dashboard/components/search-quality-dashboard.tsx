'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExperimentComparisonTable, type ExperimentStrategyResult } from './experiment-comparison-table.js';

interface SearchExperiment {
  id: string;
  name: string;
  controlStrategy: string;
  treatmentStrategy: string;
  trafficPct: number;
  status: 'running' | 'paused' | 'promoted' | 'abandoned';
  winner: string | null;
  createdAt: string;
}

interface SearchQualityDashboardProps {
  workspaceId: string;
  apiBase?: string;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#2563eb',
  promoted: '#16a34a',
  paused: '#d97706',
  abandoned: '#94a3b8',
};

export function SearchQualityDashboard({
  workspaceId,
  apiBase = '/api/v1',
}: SearchQualityDashboardProps) {
  const [experiments, setExperiments] = useState<SearchExperiment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [results, setResults] = useState<ExperimentStrategyResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);

  const loadExperiments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ workspaceId });
      const res = await fetch(`${apiBase}/admin/analytics/search-experiments?${qs}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: SearchExperiment[] };
      setExperiments(body.data);
      if (body.data.length > 0 && !selectedId) {
        setSelectedId(body.data[0]!.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load experiments');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, apiBase, selectedId]);

  const loadResults = useCallback(async (id: string) => {
    setResultsLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/analytics/search-experiments/${id}/results`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: ExperimentStrategyResult[] };
      setResults(body.data);
    } catch {
      setResults([]);
    } finally {
      setResultsLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { void loadExperiments(); }, [loadExperiments]);
  useEffect(() => { if (selectedId) void loadResults(selectedId); }, [selectedId, loadResults]);

  const handlePromote = useCallback(async (id: string, winner: string) => {
    setPromoting(true);
    try {
      const res = await fetch(`${apiBase}/admin/analytics/search-experiments/${id}/promote`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadExperiments();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to promote experiment');
    } finally {
      setPromoting(false);
    }
  }, [apiBase, loadExperiments]);

  const selected = experiments.find((e) => e.id === selectedId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Experiment list */}
      <div>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
          Active Experiments
        </h3>
        {loading ? (
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading…</p>
        ) : experiments.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
            No experiments yet. Create one via POST /admin/analytics/search-experiments.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {experiments.map((exp) => (
              <button
                key={exp.id}
                onClick={() => setSelectedId(exp.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.75rem 1rem',
                  border: `2px solid ${selectedId === exp.id ? '#2563eb' : '#e2e8f0'}`,
                  borderRadius: '0.5rem',
                  background: selectedId === exp.id ? '#eff6ff' : 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>{exp.name}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                    {exp.controlStrategy} vs {exp.treatmentStrategy} · {exp.trafficPct}% traffic
                  </p>
                </div>
                <span style={{
                  padding: '0.125rem 0.5rem', borderRadius: '9999px',
                  fontSize: '0.75rem', fontWeight: 600,
                  background: `${STATUS_COLORS[exp.status]}20`,
                  color: STATUS_COLORS[exp.status],
                }}>
                  {exp.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results panel */}
      {selected && (
        <div style={{ background: '#f8fafc', borderRadius: '0.5rem', padding: '1.25rem', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: '#111827' }}>{selected.name}</h3>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                {selected.controlStrategy} (control) vs {selected.treatmentStrategy} (treatment)
              </p>
            </div>
            {selected.status === 'running' && results.length >= 2 && !promoting && (
              <button
                onClick={() => {
                  const winner = results[1]!.metrics.ndcgAtK > results[0]!.metrics.ndcgAtK
                    ? selected.treatmentStrategy
                    : selected.controlStrategy;
                  void handlePromote(selected.id, winner);
                }}
                style={{
                  padding: '0.375rem 0.875rem', background: '#2563eb', color: 'white',
                  border: 'none', borderRadius: '0.375rem', fontWeight: 600,
                  fontSize: '0.8125rem', cursor: 'pointer',
                }}
              >
                Promote Winner
              </button>
            )}
          </div>

          {resultsLoading ? (
            <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading results…</p>
          ) : (
            <ExperimentComparisonTable results={results} winner={selected.winner} />
          )}
        </div>
      )}
    </div>
  );
}
