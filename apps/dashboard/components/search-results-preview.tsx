'use client';

import { useState } from 'react';

interface EntityResult {
  id: string;
  type: string;
  label: string;
  score: number;
  fromCache: boolean;
}

interface SearchResultsPreviewProps {
  apiBase?: string;
  weights?: Record<string, number>;
}

/**
 * Test search panel — queries the live retrieval endpoint and shows ranked results.
 */
export function SearchResultsPreview({ apiBase = '/api/v1' }: SearchResultsPreviewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EntityResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    const start = Date.now();
    try {
      const res = await fetch(`${apiBase}/queries/context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, contextBudget: 2000 }),
      });
      const body = (await res.json()) as { data?: { entities: EntityResult[] } };
      setLatencyMs(Date.now() - start);
      setResults(body.data?.entities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
          placeholder="Enter a search query to preview results…"
          style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        />
        <button
          onClick={() => void handleSearch()}
          disabled={loading || !query.trim()}
          style={{ padding: '0.5rem 1.25rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '0.375rem', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
        >
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {results !== null && (
        <div>
          <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.5rem' }}>
            {results.length} results in {latencyMs ?? 0}ms
          </p>
          {results.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No results found for this query.</p>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', overflow: 'hidden' }}>
              {results.map((r, i) => (
                <div key={r.id} style={{ padding: '0.75rem 1rem', borderBottom: i < results.length - 1 ? '1px solid #f1f5f9' : 'none', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: '0.875rem', minWidth: '1.5rem' }}>#{i + 1}</span>
                  <span style={{
                    padding: '0.125rem 0.5rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600,
                    background: '#eff6ff', color: '#2563eb',
                  }}>{r.type}</span>
                  <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>{r.label}</span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                    score: {r.score.toFixed(3)}
                  </span>
                  {r.fromCache && (
                    <span style={{ fontSize: '0.6875rem', color: '#16a34a', background: '#f0fdf4', padding: '0.125rem 0.375rem', borderRadius: '0.25rem' }}>
                      cached
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
