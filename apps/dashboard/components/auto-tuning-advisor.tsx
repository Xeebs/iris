'use client';

import { useState, useEffect, useCallback } from 'react';

interface TuningRecommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  estimatedMonthlySavingsCents: number;
  estimatedQualityImpactPct: number;
  status: string;
  abTestId: string | null;
  createdAt: string;
}

interface Props {
  workspaceId: string;
}

const TYPE_LABELS: Record<string, string> = {
  split_entity_type: 'Split Entity Type',
  merge_entity_types: 'Merge Entity Types',
  boost_freshness: 'Boost Freshness',
  disable_embedding: 'Disable Embedding',
  enable_full_text: 'Enable Full-Text Search',
  increase_batch_size: 'Increase Batch Size',
};

export default function AutoTuningAdvisor({ workspaceId }: Props) {
  const [recommendations, setRecommendations] = useState<TuningRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/optimization/recommendations`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const json = (await res.json()) as { data: TuningRecommendation[] };
      setRecommendations(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const generateNew = useCallback(async () => {
    setGenerating(true);
    try {
      await fetch('/api/v1/optimization/recommendations/generate', {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      await fetchRecommendations();
    } finally {
      setGenerating(false);
    }
  }, [workspaceId, fetchRecommendations]);

  const activateTest = useCallback(async (id: string) => {
    await fetch(`/api/v1/optimization/recommendations/${id}/apply-test`, {
      method: 'POST',
      headers: { 'x-workspace-id': workspaceId },
    });
    await fetchRecommendations();
  }, [workspaceId, fetchRecommendations]);

  const recordFeedback = useCallback(async (id: string, helpful: boolean) => {
    await fetch(`/api/v1/optimization/recommendations/${id}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-id': workspaceId },
      body: JSON.stringify({ helpful }),
    });
    await fetchRecommendations();
  }, [workspaceId, fetchRecommendations]);

  useEffect(() => { void fetchRecommendations(); }, [fetchRecommendations]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Auto-Tuning Advisor</h2>
          <p className="text-sm text-gray-500">AI-generated recommendations based on your query patterns</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void generateNew()}
            disabled={generating}
            className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {generating ? 'Analysing…' : 'Analyse Now'}
          </button>
          <button
            onClick={() => void fetchRecommendations()}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {recommendations.length === 0 && !loading && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No recommendations yet — click "Analyse Now" to scan your index.
        </div>
      )}

      <div className="space-y-3">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className="border border-gray-200 rounded-lg p-4 bg-white space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-medium">
                    {TYPE_LABELS[rec.type] ?? rec.type}
                  </span>
                  <StatusBadge status={rec.status} />
                </div>
                <p className="text-sm font-medium text-gray-900">{rec.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{rec.description}</p>
              </div>
              <div className="text-right shrink-0">
                {rec.estimatedMonthlySavingsCents > 0 && (
                  <p className="text-sm font-semibold text-green-700">
                    ${(rec.estimatedMonthlySavingsCents / 100).toFixed(2)}/mo savings
                  </p>
                )}
                {rec.estimatedQualityImpactPct > 0 && (
                  <p className="text-xs text-blue-600">+{rec.estimatedQualityImpactPct}% quality</p>
                )}
              </div>
            </div>

            {rec.status === 'pending' && (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void activateTest(rec.id)}
                  className="px-3 py-1 text-xs rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Start A/B Test (10%)
                </button>
                <button
                  onClick={() => void recordFeedback(rec.id, true)}
                  className="px-3 py-1 text-xs rounded-md bg-green-100 text-green-700 hover:bg-green-200"
                >
                  Helpful
                </button>
                <button
                  onClick={() => void recordFeedback(rec.id, false)}
                  className="px-3 py-1 text-xs rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    testing: 'bg-blue-100 text-blue-700',
    applied: 'bg-green-100 text-green-700',
    rolled_back: 'bg-red-100 text-red-700',
    dismissed: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${colors[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}
