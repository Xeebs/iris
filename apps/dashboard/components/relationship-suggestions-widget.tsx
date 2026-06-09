'use client';

import { useState, useEffect } from 'react';

type RelationshipSuggestion = {
  fromId: string;
  toId: string;
  toType: string;
  toLabel: string;
  relationshipType: string;
  confidence: number;
  reasons: string[];
};

type SuggestionMetrics = {
  totalSuggested: number;
  accepted: number;
  denied: number;
  acceptanceRate: number;
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';
const BASE = '/api/v1/relationship-recommendations';

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.8 ? 'bg-green-500' : value >= 0.6 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

type Props = {
  entityId: string;
  entityLabel?: string;
};

export function RelationshipSuggestionsWidget({ entityId, entityLabel }: Props) {
  const [suggestions, setSuggestions] = useState<RelationshipSuggestion[]>([]);
  const [metrics, setMetrics] = useState<SuggestionMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioned, setActioned] = useState<Set<string>>(new Set());

  useEffect(() => {
    void Promise.all([loadSuggestions(), loadMetrics()]);
  }, [entityId]);

  async function loadSuggestions() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/entities/${encodeURIComponent(entityId)}/suggestions?topK=10`, {
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      if (res.ok) {
        const body = await res.json() as { data: RelationshipSuggestion[] };
        setSuggestions(body.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadMetrics() {
    const res = await fetch(`${BASE}/metrics`, { headers: { 'x-workspace-id': WORKSPACE_ID } });
    if (res.ok) {
      const body = await res.json() as { data: SuggestionMetrics };
      setMetrics(body.data);
    }
  }

  async function sendFeedback(suggestion: RelationshipSuggestion, accept: boolean) {
    const key = `${suggestion.fromId}:${suggestion.toId}`;
    setActioned((prev) => new Set([...prev, key]));
    await fetch(`${BASE}/feedback/${accept ? 'accept' : 'deny'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify({ fromId: suggestion.fromId, toId: suggestion.toId }),
    });
    setSuggestions((prev) => prev.filter((s) => `${s.fromId}:${s.toId}` !== key));
  }

  async function autoLink(suggestion: RelationshipSuggestion) {
    const key = `${suggestion.fromId}:${suggestion.toId}`;
    setActioned((prev) => new Set([...prev, key]));
    await fetch(`${BASE}/auto-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify({
        fromId: suggestion.fromId,
        toId: suggestion.toId,
        relationshipType: suggestion.relationshipType,
        confidence: suggestion.confidence,
      }),
    });
    setSuggestions((prev) => prev.filter((s) => `${s.fromId}:${s.toId}` !== key));
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Relationship Suggestions</h2>
          {entityLabel && <p className="text-xs text-gray-400 mt-0.5">For: {entityLabel}</p>}
        </div>
        {metrics && (
          <div className="text-right">
            <div className="text-lg font-semibold text-white">{Math.round(metrics.acceptanceRate * 100)}%</div>
            <div className="text-xs text-gray-500">acceptance rate</div>
          </div>
        )}
      </div>

      {metrics && (
        <div className="grid grid-cols-3 gap-3 mb-5 p-3 bg-gray-800 rounded-lg">
          <div className="text-center">
            <div className="text-sm font-medium text-white">{metrics.totalSuggested}</div>
            <div className="text-xs text-gray-500">Total</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-green-400">{metrics.accepted}</div>
            <div className="text-xs text-gray-500">Accepted</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-red-400">{metrics.denied}</div>
            <div className="text-xs text-gray-500">Denied</div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-6 text-gray-500 text-sm">Loading suggestions...</div>
      ) : suggestions.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm">No suggestions available.</div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => {
            const key = `${s.fromId}:${s.toId}`;
            const busy = actioned.has(key);
            return (
              <div key={key} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-gray-100 truncate">{s.toLabel || s.toId}</span>
                      <span className="text-xs text-gray-500 capitalize bg-gray-700 px-1.5 py-0.5 rounded">{s.toType}</span>
                    </div>
                    <div className="text-xs text-blue-400 mb-2 capitalize">{s.relationshipType.replace(/_/g, ' ')}</div>
                    <ConfidenceBar value={s.confidence} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  {s.reasons.map((r, i) => (
                    <span key={i} className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">{r}</span>
                  ))}
                </div>

                <div className="flex gap-2">
                  {s.confidence >= 0.75 && (
                    <button
                      onClick={() => void autoLink(s)}
                      disabled={busy}
                      className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1.5 rounded transition-colors"
                    >
                      Auto-Link
                    </button>
                  )}
                  <button
                    onClick={() => void sendFeedback(s, true)}
                    disabled={busy}
                    className="text-xs bg-green-800 hover:bg-green-700 disabled:opacity-50 text-green-200 border border-green-700 px-3 py-1.5 rounded transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => void sendFeedback(s, false)}
                    disabled={busy}
                    className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded transition-colors"
                  >
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
