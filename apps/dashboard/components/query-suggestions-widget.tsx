'use client';

import { useState, useCallback } from 'react';

type QuerySuggestion = {
  queryText: string;
  queryHash: string;
  confidence: number;
  reason: string;
  similarityScore: number;
};

type Props = {
  onRunQuery?: (queryText: string) => void;
};

/**
 * Widget showing suggested queries based on workspace query patterns.
 * @param onRunQuery - Optional callback when user clicks a suggestion to run it
 * @returns Rendered query suggestions widget
 */
export function QuerySuggestionsWidget({ onRunQuery }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<QuerySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/v1/queries/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 5 }),
      });
      const json = await res.json() as { data?: QuerySuggestion[] };
      setSuggestions(json.data ?? []);
    } catch { setError('Failed to load suggestions'); }
    finally { setLoading(false); }
  }, []);

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Query Suggestions</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void loadSuggestions(query)}
          placeholder="Type a query to get suggestions…"
          style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
        <button onClick={() => void loadSuggestions(query)} disabled={loading}
          style={{ padding: '7px 14px', background: loading ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? '…' : 'Suggest'}
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {suggestions.length === 0 && !loading ? (
        <div style={{ color: '#9ca3af', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
          {query ? 'No suggestions found for this query.' : 'Enter a query above to see suggestions.'}
        </div>
      ) : (
        <div>
          {suggestions.map(s => (
            <div key={s.queryHash} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: '#111827', marginBottom: 2 }}>{s.queryText}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>{s.reason}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#16a34a' }}>
                  {Math.round(s.confidence * 100)}%
                </span>
                {onRunQuery && (
                  <button onClick={() => onRunQuery(s.queryText)}
                    style={{ padding: '2px 8px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>
                    Run
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
