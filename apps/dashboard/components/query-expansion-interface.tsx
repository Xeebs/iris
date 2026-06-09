'use client';

import { useState } from 'react';

type FeedbackMark = 'stale' | 'incomplete' | 'irrelevant' | 'useful';

type ExpandedResult = {
  entityId: string;
  entityType: string;
  label: string;
  score: number;
  stage: number;
};

type ExpansionDirection = {
  axis: string;
  value: string;
  relevanceScore: number;
  reason: string;
};

type ExpansionSession = {
  sessionId: string;
  query: string;
  stage: number;
  results: ExpandedResult[];
  directions: ExpansionDirection[];
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';
const BASE = '/api/v1/query-expansion';

const MARK_STYLES: Record<FeedbackMark, string> = {
  useful: 'bg-green-800 text-green-200 border-green-700 hover:bg-green-700',
  stale: 'bg-yellow-900 text-yellow-200 border-yellow-700 hover:bg-yellow-800',
  incomplete: 'bg-orange-900 text-orange-200 border-orange-700 hover:bg-orange-800',
  irrelevant: 'bg-red-900 text-red-200 border-red-700 hover:bg-red-800',
};

const MARK_LABELS: Record<FeedbackMark, string> = {
  useful: 'Useful',
  stale: 'Stale',
  incomplete: 'Incomplete',
  irrelevant: 'Irrelevant',
};

type Props = {
  initialQuery?: string;
};

export function QueryExpansionInterface({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [session, setSession] = useState<ExpansionSession | null>(null);
  const [feedback, setFeedback] = useState<Map<string, FeedbackMark>>(new Map());
  const [loading, setLoading] = useState(false);

  async function expand(stage = 1) {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const feedbackList = [...feedback.entries()].map(([entityId, mark]) => ({ entityId, mark }));
      const res = await fetch(`${BASE}/expand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({ query, stage, feedback: feedbackList }),
      });
      if (res.ok) {
        const body = await res.json() as { data: ExpansionSession };
        setSession(body.data);
        setFeedback(new Map());
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitFeedbackAndRefine() {
    if (!session || feedback.size === 0) return;
    setLoading(true);
    try {
      const feedbackList = [...feedback.entries()].map(([entityId, mark]) => ({ entityId, mark }));
      await fetch(`${BASE}/sessions/${encodeURIComponent(session.sessionId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({ feedback: feedbackList }),
      });
      await expand(session.stage + 1);
    } finally {
      setLoading(false);
    }
  }

  function markEntity(entityId: string, mark: FeedbackMark) {
    setFeedback((prev) => {
      const next = new Map(prev);
      if (next.get(entityId) === mark) next.delete(entityId);
      else next.set(entityId, mark);
      return next;
    });
  }

  const marks: FeedbackMark[] = ['useful', 'stale', 'incomplete', 'irrelevant'];

  return (
    <div className="space-y-5">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-3">Iterative Query Expansion</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void expand(1)}
            placeholder="Enter search query..."
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={() => void expand(1)}
            disabled={loading || !query.trim()}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {session && (
        <>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Results — Stage {session.stage}</h3>
              {feedback.size > 0 && (
                <button
                  onClick={() => void submitFeedbackAndRefine()}
                  disabled={loading}
                  className="text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors"
                >
                  Refine with Feedback ({feedback.size})
                </button>
              )}
            </div>
            <div className="space-y-2">
              {session.results.map((r) => {
                const mark = feedback.get(r.entityId);
                return (
                  <div
                    key={r.entityId}
                    className={`bg-gray-800 border rounded-lg p-3 ${mark === 'irrelevant' ? 'border-red-800 opacity-60' : mark === 'useful' ? 'border-green-800' : 'border-gray-700'}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-200 truncate">{r.label || r.entityId}</span>
                          <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded capitalize">{r.entityType}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <div className="flex-1 bg-gray-700 rounded-full h-1">
                            <div className="bg-blue-500 h-1 rounded-full" style={{ width: `${Math.round(r.score * 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{Math.round(r.score * 100)}%</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {marks.map((m) => (
                          <button
                            key={m}
                            onClick={() => markEntity(r.entityId, m)}
                            className={`text-xs border px-1.5 py-0.5 rounded transition-colors ${mark === m ? MARK_STYLES[m] : 'bg-gray-700 text-gray-400 border-gray-600 hover:bg-gray-600'}`}
                          >
                            {MARK_LABELS[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              {session.results.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">No results found.</p>
              )}
            </div>
          </div>

          {session.directions.length > 0 && (
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-white mb-3">Suggested Expansions</h3>
              <div className="space-y-2">
                {session.directions.map((d, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div>
                      <span className="text-xs text-blue-400 capitalize">{d.axis.replace('_', ' ')}</span>
                      <span className="text-sm text-gray-200 ml-2">{d.value}</span>
                      <p className="text-xs text-gray-500 mt-0.5">{d.reason}</p>
                    </div>
                    <div className="text-xs text-gray-400 shrink-0">{Math.round(d.relevanceScore * 100)}%</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
