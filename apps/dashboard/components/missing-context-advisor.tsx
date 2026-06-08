'use client';

import { useState, useCallback } from 'react';

type MissingContextCandidate = {
  entityType: string;
  attribute: string;
  suggestionConfidence: number;
  useCase: string;
};

/**
 * Advisor panel that identifies attributes frequently queried alongside an entity type
 * but not present in the current result set.
 * @returns Rendered missing context advisor panel
 */
export function MissingContextAdvisor() {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MissingContextCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!query.trim()) { setError('Enter a query to analyze'); return; }
    setLoading(true); setError(null); setCandidates([]);
    try {
      const res = await fetch('/api/v1/queries/missing-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), presentAttributes: [] }),
      });
      const json = await res.json() as { data?: MissingContextCandidate[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed');
      setCandidates(json.data ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Analysis failed'); }
    finally { setLoading(false); }
  }, [query]);

  const confidenceColor = (conf: number) =>
    conf >= 0.8 ? '#16a34a' : conf >= 0.6 ? '#ca8a04' : '#6b7280';

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Missing Context Advisor</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
        Identify attributes commonly queried with this entity type that aren&apos;t in your current results.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void analyze()}
          placeholder="e.g. find enterprise contacts…"
          style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
        <button onClick={() => void analyze()} disabled={loading}
          style={{ padding: '7px 14px', background: loading ? '#9ca3af' : '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '…' : 'Analyze'}
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {candidates.length === 0 && !loading ? (
        <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          {query ? 'No missing context detected.' : 'Enter a query to analyze for missing context.'}
        </div>
      ) : (
        <div>
          {candidates.map(c => (
            <div key={`${c.entityType}:${c.attribute}`} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{c.attribute}</span>
                  <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 6 }}>({c.entityType})</span>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{c.useCase}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: 12, color: confidenceColor(c.suggestionConfidence) }}>
                {Math.round(c.suggestionConfidence * 100)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
