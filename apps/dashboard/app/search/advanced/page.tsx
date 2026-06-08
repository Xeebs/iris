'use client';

import { useState, useCallback, useRef } from 'react';

type SearchResult = {
  entityId: string;
  entityType: string;
  label: string;
  connectorId: string;
  score: number;
  attributes: Record<string, unknown>;
};

type FacetCount = {
  field: string;
  value: string;
  count: number;
};

type SearchResponse = {
  results: SearchResult[];
  total: number;
  nextCursor: string | null;
  facets: FacetCount[];
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  contact: '#2563eb', company: '#16a34a', deal: '#d97706',
  activity: '#7c3aed', document: '#0891b2',
};

function EntityCard({ entity }: { entity: SearchResult }) {
  const color = ENTITY_TYPE_COLORS[entity.entityType] ?? '#6b7280';
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{entity.label}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace', marginTop: 2 }}>{entity.entityId}</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ padding: '2px 8px', background: color + '15', color, border: `1px solid ${color}40`, borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
            {entity.entityType}
          </span>
          <span style={{ padding: '2px 8px', background: '#f3f4f6', color: '#6b7280', borderRadius: 10, fontSize: 11 }}>
            {entity.connectorId}
          </span>
        </div>
      </div>
      {Object.keys(entity.attributes).length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {Object.entries(entity.attributes).slice(0, 5).map(([k, v]) => (
            <span key={k} style={{ fontSize: 11, color: '#6b7280', background: '#f9fafb', padding: '1px 6px', borderRadius: 4, border: '1px solid #e5e7eb' }}>
              {k}: {String(v ?? '—')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Advanced entity search page with filter builder, facets, and paginated results.
 */
export default function AdvancedSearchPage() {
  const [query, setQuery] = useState('');
  const [filterInput, setFilterInput] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [facets, setFacets] = useState<FacetCount[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const API_BASE = '/api/v1';

  const runSearch = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    const filters = activeFilters.join(' ');
    try {
      const res = await fetch(`${API_BASE}/entities/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, filters, limit: 50, cursor }),
      });
      const json = await res.json() as { data?: SearchResponse; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Search failed');
      const data = json.data!;
      setResults(cursor ? prev => [...prev, ...data.results] : data.results);
      setFacets(data.facets);
      setNextCursor(data.nextCursor);
      setSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, activeFilters]);

  const fetchSuggestions = (partial: string) => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    suggestTimer.current = setTimeout(async () => {
      if (!partial) { setSuggestions([]); return; }
      const res = await fetch(`${API_BASE}/entities/search-suggestions?q=${encodeURIComponent(partial)}`);
      const json = await res.json() as { data?: string[] };
      setSuggestions(json.data ?? []);
    }, 200);
  };

  const addFilter = (filter: string) => {
    if (!activeFilters.includes(filter)) {
      setActiveFilters(prev => [...prev, filter]);
    }
    setFilterInput('');
    setSuggestions([]);
  };

  const removeFilter = (f: string) => setActiveFilters(prev => prev.filter(x => x !== f));

  const handleFilterKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && filterInput.trim()) {
      addFilter(filterInput.trim());
    }
  };

  return (
    <div style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 1000 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Advanced Search</h1>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '0 0 24px' }}>
        Search entities with filters like <code style={{ background: '#f3f4f6', padding: '0 4px', borderRadius: 3 }}>type:contact email:*@acme.com status:active</code>
      </p>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void runSearch()}
          placeholder="Search entity labels…"
          style={{ flex: 1, padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
        />
        <button
          onClick={() => void runSearch()}
          disabled={loading}
          style={{ padding: '9px 20px', background: loading ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Filter builder */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, minHeight: 42, alignItems: 'center' }}>
          {activeFilters.map(f => (
            <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 12, color: '#1d4ed8' }}>
              {f}
              <button onClick={() => removeFilter(f)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', padding: 0, fontSize: 12 }}>×</button>
            </span>
          ))}
          <input
            value={filterInput}
            onChange={e => { setFilterInput(e.target.value); fetchSuggestions(e.target.value); }}
            onKeyDown={handleFilterKeyDown}
            placeholder={activeFilters.length ? 'Add filter…' : 'Filter: type:contact status:active email:*@acme.com'}
            style={{ flex: 1, minWidth: 180, border: 'none', outline: 'none', fontSize: 13 }}
          />
        </div>
        {suggestions.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => addFilter(s)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', color: '#374151' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20 }}>
        {/* Facets */}
        {facets.length > 0 && (
          <div style={{ width: 160, flexShrink: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Entity Types</div>
            {facets.map(f => (
              <button
                key={f.value}
                onClick={() => addFilter(`type:${f.value}`)}
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '5px 8px', border: '1px solid transparent', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', color: '#374151', marginBottom: 3 }}
              >
                <span>{f.value}</span>
                <span style={{ color: '#9ca3af' }}>{f.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div style={{ flex: 1 }}>
          {searched && !loading && results.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
              No entities found. Try different search terms or filters.
            </div>
          )}
          {results.map(r => <EntityCard key={r.entityId} entity={r} />)}
          {nextCursor && (
            <button
              onClick={() => void runSearch(nextCursor)}
              disabled={loading}
              style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: '#fff', color: '#374151', marginTop: 8 }}
            >
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
