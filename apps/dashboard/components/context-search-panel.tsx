'use client';

import React, { useState } from 'react';

export type SearchResult = {
  matchId: string;
  entityId: string;
  entityType: string;
  entityLabel: string;
  score: number;
  matchingFields: string[];
  rank: number;
};

type Props = {
  responseId: string;
  workspaceId: string;
  onSearch?: (query: string) => Promise<SearchResult[]>;
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-yellow-400' : 'bg-orange-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
    </div>
  );
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  contact: 'bg-blue-100 text-blue-700',
  deal: 'bg-green-100 text-green-700',
  company: 'bg-purple-100 text-purple-700',
  activity: 'bg-orange-100 text-orange-700',
};

export function ContextSearchPanel({ responseId, workspaceId, onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !onSearch) return;
    setIsSearching(true);
    try {
      const found = await onSearch(query);
      setResults(found);
      setHasSearched(true);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
          placeholder="Search within this response context…"
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={!query.trim() || isSearching}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isSearching ? '…' : 'Search'}
        </button>
      </div>

      {hasSearched && (
        <>
          {results.length === 0 ? (
            <div className="py-4 text-center text-sm text-gray-500">
              No matching entities found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">{results.length} result(s) for &ldquo;{query}&rdquo;</p>
              {results.map((result) => (
                <div key={result.matchId} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                    {result.rank}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 truncate">{result.entityLabel}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${ENTITY_TYPE_COLORS[result.entityType] ?? 'bg-gray-100 text-gray-600'}`}>
                        {result.entityType}
                      </span>
                    </div>
                    {result.matchingFields.length > 0 && (
                      <p className="text-xs text-gray-500">
                        Matched in: {result.matchingFields.join(', ')}
                      </p>
                    )}
                    <ScoreBar score={result.score} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!hasSearched && (
        <p className="text-xs text-gray-400 text-center py-2">
          Search entities from response {responseId} within workspace {workspaceId}
        </p>
      )}
    </div>
  );
}
