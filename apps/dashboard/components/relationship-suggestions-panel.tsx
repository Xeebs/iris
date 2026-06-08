'use client';

import { useState } from 'react';

type DiscoveryMethod = 'cooccurrence' | 'embedding_similarity' | 'metadata_pattern';

type InferredRelationship = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipTypePredicted: string;
  confidenceScore: number;
  discoveryMethod: DiscoveryMethod;
  suggestedAt: string;
};

type RelationshipSuggestionsPanelProps = {
  workspaceId: string;
  initialSuggestions?: InferredRelationship[];
};

const METHOD_LABELS: Record<DiscoveryMethod, string> = {
  cooccurrence: 'Co-occurrence',
  embedding_similarity: 'Embedding Similarity',
  metadata_pattern: 'Metadata Pattern',
};

const METHOD_COLORS: Record<DiscoveryMethod, string> = {
  cooccurrence: 'bg-blue-100 text-blue-800',
  embedding_similarity: 'bg-purple-100 text-purple-800',
  metadata_pattern: 'bg-gray-100 text-gray-800',
};

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 90 ? 'bg-green-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-orange-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-10 text-right text-gray-600">{pct}%</span>
    </div>
  );
}

function EntityIdBadge({ entityId }: { entityId: string }) {
  const parts = entityId.split(':');
  const short = parts.length >= 3 ? `${parts[0]}:${parts[2]}` : entityId;
  return (
    <span
      className="inline-block max-w-[140px] truncate font-mono text-xs bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5"
      title={entityId}
    >
      {short}
    </span>
  );
}

export function RelationshipSuggestionsPanel({ workspaceId, initialSuggestions = [] }: RelationshipSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = useState<InferredRelationship[]>(initialSuggestions);
  const [loading, setLoading] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchSuggestions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/graph/inferred-relationships?topK=20', {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: InferredRelationship[] };
      setSuggestions(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(relId: string, action: 'confirm' | 'reject') {
    setActionInFlight(relId);
    try {
      const res = await fetch(`/api/v1/graph/inferred/${relId}/${action}`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuggestions(prev => prev.filter(s => s.id !== relId));
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action} relationship`);
    } finally {
      setActionInFlight(null);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Relationship Suggestions</h2>
          <p className="text-xs text-gray-500 mt-0.5">AI-inferred links awaiting review</p>
        </div>
        <button
          onClick={fetchSuggestions}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {suggestions.length === 0 && !loading && (
        <div className="py-10 text-center text-sm text-gray-400">
          No pending suggestions.{' '}
          <button onClick={fetchSuggestions} className="underline hover:text-gray-600">
            Load from server
          </button>
        </div>
      )}

      <ul className="divide-y divide-gray-50">
        {suggestions.map(s => {
          const busy = actionInFlight === s.id;
          return (
            <li key={s.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
                    <EntityIdBadge entityId={s.sourceEntityId} />
                    <span className="font-medium text-indigo-600">{s.relationshipTypePredicted}</span>
                    <EntityIdBadge entityId={s.targetEntityId} />
                  </div>

                  <ConfidenceBar score={s.confidenceScore} />

                  <div className="flex items-center gap-2">
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${METHOD_COLORS[s.discoveryMethod]}`}>
                      {METHOD_LABELS[s.discoveryMethod]}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(s.suggestedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex gap-1.5 shrink-0 mt-0.5">
                  <button
                    onClick={() => handleAction(s.id, 'confirm')}
                    disabled={busy}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => handleAction(s.id, 'reject')}
                    disabled={busy}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {suggestions.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
          {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''} pending review
        </div>
      )}
    </div>
  );
}
