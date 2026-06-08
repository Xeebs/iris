'use client';

import { useState, useCallback, useRef } from 'react';
import type { SearchFilters, SearchResultItem as SearchResultItemType, SearchSuggestion } from '@iris/semantic-core/hybrid-search-engine';
import { SearchQueryBuilder } from '@/components/search-query-builder';
import { FacetedFilterSidebar } from '@/components/faceted-filter-sidebar';
import { SearchResultItem } from '@/components/search-result-item';

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

interface SearchData {
  results: SearchResultItemType[];
  total: number;
  hasMore: boolean;
  suggestions?: SearchSuggestion[];
  durationMs: number;
}

const ENTITY_TYPE_OPTIONS = [
  { value: 'contact', label: 'Contact' },
  { value: 'company', label: 'Company' },
  { value: 'deal', label: 'Deal' },
  { value: 'issue', label: 'Issue' },
  { value: 'page', label: 'Page' },
  { value: 'record', label: 'Record' },
];

const CONNECTOR_OPTIONS = [
  { value: 'hubspot', label: 'HubSpot' },
  { value: 'salesforce', label: 'Salesforce' },
  { value: 'notion', label: 'Notion' },
  { value: 'slack', label: 'Slack' },
  { value: 'jira', label: 'Jira' },
  { value: 'google-drive', label: 'Google Drive' },
];

function SortSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="relevance">Most Relevant</option>
      <option value="newest">Newest First</option>
      <option value="oldest">Oldest First</option>
      <option value="label_asc">A → Z</option>
      <option value="label_desc">Z → A</option>
    </select>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <svg className="h-7 w-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1 0 6.5 14.15a7.5 7.5 0 0 0 10.15 2.5z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">No results for &ldquo;{query}&rdquo;</p>
      <p className="text-xs text-gray-400">Try different keywords, remove filters, or check the query syntax guide.</p>
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [sortBy, setSortBy] = useState('relevance');
  const [showExplanation, setShowExplanation] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<SearchData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (q: string, f: SearchFilters = filters, sort = sortBy) => {
    if (!q.trim()) return;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          query: q,
          filters: f,
          limit: 20,
          offset: 0,
          sortBy: sort,
          includeSuggestions: true,
          explainScoring: showExplanation,
        }),
      });

      if (!res.ok) {
        const json = await res.json() as { error?: { message?: string } };
        throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      }

      const json = await res.json() as { data: SearchData };
      setData(json.data);
      setHistory((prev) => [q, ...prev.filter((h) => h !== q)].slice(0, 10));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [filters, sortBy, showExplanation]);

  function handleFilterChange(f: SearchFilters) {
    setFilters(f);
    if (query.trim()) runSearch(query, f, sortBy);
  }

  function handleSortChange(s: string) {
    setSortBy(s);
    if (query.trim()) runSearch(query, filters, s);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Entity Search</h1>
          <p className="mt-1 text-sm text-gray-500">
            Hybrid BM25 + semantic search across all indexed entities
          </p>
        </div>

        {/* Search bar */}
        <div className="mb-6">
          <SearchQueryBuilder
            value={query}
            onChange={setQuery}
            onSearch={(q) => runSearch(q)}
            suggestions={data?.suggestions}
            history={history}
            isLoading={isLoading}
          />
        </div>

        <div className="flex gap-6">
          {/* Filters */}
          <FacetedFilterSidebar
            entityTypeOptions={ENTITY_TYPE_OPTIONS}
            connectorOptions={CONNECTOR_OPTIONS}
            filters={filters}
            onChange={handleFilterChange}
          />

          {/* Results */}
          <div className="min-w-0 flex-1">
            {/* Toolbar */}
            {data && (
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  {data.total} result{data.total !== 1 ? 's' : ''}
                  {data.durationMs > 0 && <> &middot; {data.durationMs}ms</>}
                </p>
                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={showExplanation}
                      onChange={(e) => {
                        setShowExplanation(e.target.checked);
                        if (query.trim()) runSearch(query, filters, sortBy);
                      }}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600"
                    />
                    Show scores
                  </label>
                  <SortSelector value={sortBy} onChange={handleSortChange} />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Results list */}
            {data && data.results.length === 0 && query && (
              <EmptyState query={query} />
            )}

            {data && data.results.length > 0 && (
              <div className="space-y-3">
                {data.results.map((item) => (
                  <SearchResultItem
                    key={item.id}
                    item={item}
                    showExplanation={showExplanation}
                  />
                ))}
              </div>
            )}

            {/* Initial state */}
            {!data && !isLoading && !error && (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-400">
                  Enter a query above to search across all indexed entities.
                </p>
                <p className="mt-1 text-xs text-gray-300">
                  Supports quoted phrases, field:value filters, and boolean operators.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
