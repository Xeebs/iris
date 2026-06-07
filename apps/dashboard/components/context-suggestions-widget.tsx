'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestedContext {
  entityType: string;
  label: string;
  reason: string;
  confidence: number;
  entityId?: string;
}

interface ContextSuggestionsWidgetProps {
  workspaceId: string;
  userId?: string;
  userRole?: string;
  apiBase?: string;
}

const CONFIDENCE_COLOR = (c: number): string => {
  if (c >= 0.8) return 'text-green-600';
  if (c >= 0.6) return 'text-yellow-600';
  return 'text-gray-400';
};

const TYPE_ICON: Record<string, string> = {
  deal: '💼',
  contact: '👤',
  company: '🏢',
  issue: '🐛',
  metric: '📊',
  document: '📄',
  message: '💬',
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Widget that surfaces proactive context suggestions based on recent activity.
 * Calls the suggestions API to generate top-N entity type recommendations.
 *
 * @param workspaceId - Workspace to fetch suggestions for
 * @param userId      - User to personalise suggestions (defaults to 'system')
 * @param userRole    - Optional role for role-affinity suggestions
 * @param apiBase     - API base URL (defaults to env var)
 */
export function ContextSuggestionsWidget({
  workspaceId,
  userId = 'system',
  userRole,
  apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1',
}: ContextSuggestionsWidgetProps): React.JSX.Element {
  const [suggestions, setSuggestions] = useState<SuggestedContext[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/context-suggestions?workspaceId=${encodeURIComponent(workspaceId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            ...(userRole !== undefined ? { userRole } : {}),
            recentActivity: [],
            maxSuggestions: 3,
          }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: { suggestions: SuggestedContext[] } };
      setSuggestions(body.data.suggestions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }, [apiBase, workspaceId, userId, userRole]);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-400">Loading suggestions…</p>
      </div>
    );
  }

  if (error || suggestions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-5 text-center">
        <p className="text-sm text-gray-400">
          {error ? 'Unable to load suggestions.' : 'No context suggestions yet.'}
        </p>
        {error && (
          <button
            type="button"
            onClick={() => void fetchSuggestions()}
            className="mt-2 text-xs text-indigo-600 hover:underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">Suggested Context</h3>
        <button
          type="button"
          onClick={() => void fetchSuggestions()}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Refresh
        </button>
      </div>
      <ul className="divide-y divide-gray-50">
        {suggestions.map((s, i) => (
          <li key={`${s.entityType}-${i}`} className="flex items-start gap-3 px-5 py-3">
            <span className="mt-0.5 text-lg leading-none">
              {TYPE_ICON[s.entityType] ?? '🔍'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{s.label}</p>
              <p className="text-xs text-gray-500 truncate">{s.reason}</p>
            </div>
            <span className={`text-xs font-medium tabular-nums ${CONFIDENCE_COLOR(s.confidence)}`}>
              {Math.round(s.confidence * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
