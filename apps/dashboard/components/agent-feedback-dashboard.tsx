'use client';

import { useState } from 'react';

type AgentInsights = {
  agentId: string;
  totalUsages: number;
  avgRating: number;
  mostUsefulEntityTypes: string[];
  leastUsefulEntityTypes: string[];
  feedbackCount: number;
  contextExpansionSuggestion: {
    suggestedEntityTypes: string[];
    reasoning: string;
    confidenceScore: number;
  } | null;
};

type RelevanceAdjustment = {
  entityType: string;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  weightAdjustment: number;
};

type AgentFeedbackDashboardProps = {
  workspaceId: string;
  agentId?: string;
};

function RatingStars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`text-sm ${i < full ? 'text-yellow-400' : 'text-gray-200'}`}>★</span>
      ))}
      <span className="ml-1 text-xs text-gray-600">{rating.toFixed(1)}</span>
    </span>
  );
}

function WeightBar({ weight }: { weight: number }) {
  const pct = Math.abs(weight) * 100;
  const color = weight > 0 ? 'bg-green-400' : 'bg-red-400';
  const dir = weight >= 0 ? 'positive' : 'negative';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-mono w-14 text-right ${weight > 0 ? 'text-green-700' : 'text-red-600'}`}>
        {dir === 'positive' ? '+' : ''}{(weight * 100).toFixed(0)}%
      </span>
    </div>
  );
}

export function AgentFeedbackDashboard({ workspaceId, agentId = 'default' }: AgentFeedbackDashboardProps) {
  const [insights, setInsights] = useState<AgentInsights | null>(null);
  const [adjustments, setAdjustments] = useState<RelevanceAdjustment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState(agentId);

  async function fetchInsights(id: string) {
    setLoading(true);
    setError(null);
    try {
      const [insRes, adjRes] = await Promise.all([
        fetch(`/api/v1/agents/${id}/insights`, { headers: { 'x-workspace-id': workspaceId } }),
        fetch(`/api/v1/agents/relevance-adjustments`, { headers: { 'x-workspace-id': workspaceId } }),
      ]);
      if (!insRes.ok || !adjRes.ok) throw new Error(`HTTP error`);
      const insBody = await insRes.json() as { data: AgentInsights };
      const adjBody = await adjRes.json() as { data: RelevanceAdjustment[] };
      setInsights(insBody.data);
      setAdjustments(adjBody.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Agent Feedback Dashboard</h2>
          <p className="text-xs text-gray-500 mt-0.5">Closed-loop context quality learning</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={activeAgentId}
            onChange={e => setActiveAgentId(e.target.value)}
            placeholder="Agent ID"
            className="text-sm px-2 py-1.5 rounded-md border border-gray-300 w-40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={() => fetchInsights(activeAgentId)}
            disabled={loading || !activeAgentId}
            className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {insights && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs text-gray-500 mb-1">Avg rating</div>
              <RatingStars rating={insights.avgRating} />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-xl font-bold text-gray-800">{insights.totalUsages}</div>
              <div className="text-xs text-gray-500 mt-0.5">Context uses</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-xl font-bold text-gray-800">{insights.feedbackCount}</div>
              <div className="text-xs text-gray-500 mt-0.5">Feedback items</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Entity type quality */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Entity Type Quality</h3>
              <div className="space-y-2">
                {adjustments.length === 0 ? (
                  <p className="text-xs text-gray-400">No feedback data yet.</p>
                ) : (
                  adjustments.map(adj => (
                    <div key={adj.entityType}>
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-xs text-gray-700">{adj.entityType}</span>
                        <span className="text-xs text-gray-400">{adj.positiveFeedbackCount}↑ {adj.negativeFeedbackCount}↓</span>
                      </div>
                      <WeightBar weight={adj.weightAdjustment} />
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Context expansion suggestions */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Context Expansion</h3>
              {insights.contextExpansionSuggestion ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">{insights.contextExpansionSuggestion.reasoning}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {insights.contextExpansionSuggestion.suggestedEntityTypes.map(t => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">{t}</span>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500">
                    Confidence: <span className="font-medium text-gray-700">{Math.round(insights.contextExpansionSuggestion.confidenceScore * 100)}%</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400">Not enough feedback to generate suggestions.</p>
              )}

              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="text-xs font-medium text-gray-600 mb-1.5">Most useful</div>
                <div className="flex flex-wrap gap-1">
                  {insights.mostUsefulEntityTypes.map(t => (
                    <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700">{t}</span>
                  ))}
                </div>
                <div className="text-xs font-medium text-gray-600 mt-2 mb-1.5">Least useful</div>
                <div className="flex flex-wrap gap-1">
                  {insights.leastUsefulEntityTypes.map(t => (
                    <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-600">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {!insights && !loading && (
        <div className="py-10 text-center text-sm text-gray-400">
          Enter an agent ID and click Load to view feedback insights.
        </div>
      )}
    </div>
  );
}
