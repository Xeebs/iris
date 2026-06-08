'use client';

import { useState, useEffect } from 'react';
import { RelevanceFactorControl } from '@/components/relevance-factor-control';
import { SearchResultsPreview } from '@/components/search-results-preview';
import { TuningFeedbackAnalytics } from '@/components/tuning-feedback-analytics';

interface ScoringWeights {
  bm25_weight: number;
  embedding_weight: number;
  type_boost_contact: number;
  type_boost_deal: number;
  type_boost_company: number;
  recency_boost: number;
  relationship_distance_penalty: number;
}

const FACTOR_LABELS: Record<keyof ScoringWeights, string> = {
  bm25_weight: 'BM25 Full-Text Weight',
  embedding_weight: 'Semantic Embedding Weight',
  type_boost_contact: 'Contact Type Boost',
  type_boost_deal: 'Deal Type Boost',
  type_boost_company: 'Company Type Boost',
  recency_boost: 'Recency Boost',
  relationship_distance_penalty: 'Relationship Distance Penalty',
};

export default function SearchTuningPage() {
  const [weights, setWeights] = useState<ScoringWeights | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'controls' | 'preview' | 'analytics'>('controls');

  useEffect(() => {
    void fetchWeights();
  }, []);

  async function fetchWeights() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/search-tuning/weights');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: ScoringWeights };
      setWeights(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load weights');
    } finally {
      setLoading(false);
    }
  }

  async function handleWeightChange(factor: keyof ScoringWeights, value: number) {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/v1/search-tuning/weights', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factorName: factor, tunedValue: value }),
      });
      const body = (await res.json()) as { data?: ScoringWeights; error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
      setWeights(body.data!);
      setSuccessMsg(`${FACTOR_LABELS[factor]} updated.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save weight');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('Reset all weights to defaults?')) return;
    setSaving(true);
    try {
      await fetch('/api/v1/search-tuning/weights', { method: 'DELETE' });
      await fetchWeights();
      setSuccessMsg('Weights reset to defaults.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError('Reset failed');
    } finally {
      setSaving(false);
    }
  }

  const tabs = [
    { id: 'controls' as const, label: 'Tuning Controls' },
    { id: 'preview' as const, label: 'Test Search' },
    { id: 'analytics' as const, label: 'Feedback Analytics' },
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Search Relevance Tuning
          </h1>
          <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
            Configure scoring weights and review click-through analytics to improve search quality.
          </p>
        </div>
        <button
          onClick={() => void handleReset()}
          disabled={saving}
          style={{ padding: '0.5rem 1rem', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' }}
        >
          Reset to Defaults
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {successMsg && (
        <div style={{ padding: '0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', color: '#16a34a', fontSize: '0.875rem', marginBottom: '1rem' }}>
          {successMsg}
        </div>
      )}

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: '0.125rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '0.625rem 1rem',
              border: 'none',
              background: 'transparent',
              fontSize: '0.875rem',
              fontWeight: activeTab === tab.id ? 700 : 400,
              color: activeTab === tab.id ? '#2563eb' : '#64748b',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: '-2px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading…</p>}

      {!loading && weights && activeTab === 'controls' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {(Object.keys(weights) as Array<keyof ScoringWeights>).map((factor) => (
            <RelevanceFactorControl
              key={factor}
              label={FACTOR_LABELS[factor]}
              value={weights[factor]}
              disabled={saving}
              onChange={(v) => void handleWeightChange(factor, v)}
            />
          ))}
        </div>
      )}

      {activeTab === 'preview' && (
        <SearchResultsPreview weights={weights ?? undefined} />
      )}

      {activeTab === 'analytics' && (
        <TuningFeedbackAnalytics />
      )}
    </div>
  );
}
