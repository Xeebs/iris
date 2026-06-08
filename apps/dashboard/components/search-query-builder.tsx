'use client';

import { useState, useRef, useEffect } from 'react';

interface SearchQueryBuilderProps {
  value: string;
  onChange: (query: string) => void;
  onSearch: (query: string) => void;
  suggestions?: Array<{ text: string; type: string }>;
  history?: string[];
  isLoading?: boolean;
}

const SYNTAX_EXAMPLES = [
  { label: 'Quoted phrase', example: '"exact phrase"' },
  { label: 'Field filter', example: 'status:active' },
  { label: 'Boolean AND', example: 'revenue AND growth' },
  { label: 'Exclude term', example: 'deals NOT closed' },
];

/**
 * Search input with autocomplete suggestions, search history, and syntax hint popover.
 */
export function SearchQueryBuilder({
  value,
  onChange,
  onSearch,
  suggestions = [],
  history = [],
  isLoading = false,
}: SearchQueryBuilderProps) {
  const [showHints, setShowHints] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setShowSuggestions(suggestions.length > 0 && value.length > 1);
  }, [suggestions, value]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      setShowSuggestions(false);
      onSearch(value);
    }
    if (e.key === 'Escape') {
      setShowSuggestions(false);
      setShowHints(false);
    }
  }

  function selectSuggestion(text: string) {
    onChange(text);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 shadow-sm focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
        <svg className="h-5 w-5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1 0 6.5 14.15a7.5 7.5 0 0 0 10.15 2.5z" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 outline-none"
          placeholder='Search entities… try "status:active" or "open deals"'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => history.length > 0 && !value && setShowSuggestions(true)}
        />

        {isLoading && (
          <svg className="h-4 w-4 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
            <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" className="opacity-75" />
          </svg>
        )}

        {value && !isLoading && (
          <button
            type="button"
            className="text-gray-400 hover:text-gray-600"
            onClick={() => { onChange(''); setShowSuggestions(false); }}
            aria-label="Clear"
          >
            ×
          </button>
        )}

        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
          onClick={() => setShowHints((v) => !v)}
          title="Query syntax help"
        >
          ?
        </button>

        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          onClick={() => onSearch(value)}
          disabled={isLoading || !value.trim()}
        >
          Search
        </button>
      </div>

      {/* Syntax hints popover */}
      {showHints && (
        <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-semibold text-gray-700">Query syntax</p>
          <ul className="space-y-1.5">
            {SYNTAX_EXAMPLES.map((ex) => (
              <li key={ex.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-gray-500">{ex.label}</span>
                <code
                  className="cursor-pointer rounded bg-gray-100 px-1.5 py-0.5 font-mono text-indigo-700 hover:bg-indigo-50"
                  onClick={() => { onChange(ex.example); setShowHints(false); inputRef.current?.focus(); }}
                >
                  {ex.example}
                </code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showSuggestions && (suggestions.length > 0 || history.length > 0) && (
        <ul className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.text}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50"
                onClick={() => selectSuggestion(s.text)}
              >
                <span className="rounded bg-indigo-50 px-1 text-xs text-indigo-600">{s.type}</span>
                <span>{s.text}</span>
              </button>
            </li>
          ))}
          {suggestions.length === 0 && history.slice(0, 5).map((h) => (
            <li key={h}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
                onClick={() => selectSuggestion(h)}
              >
                <svg className="h-3.5 w-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                </svg>
                {h}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
