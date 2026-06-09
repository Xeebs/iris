'use client';

import { useState, useEffect } from 'react';

type MatchCandidate = {
  candidateId: string;
  candidateConnector: string;
  confidence: number;
  attributeOverlap: number;
  reasons: string[];
};

type ReconciliationDecision = 'merge' | 'link' | 'reject';

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';
const BASE = '/api/v1';

const DECISION_STYLES: Record<ReconciliationDecision, string> = {
  merge: 'bg-blue-600 hover:bg-blue-500 text-white',
  link: 'bg-green-700 hover:bg-green-600 text-green-100',
  reject: 'bg-gray-700 hover:bg-gray-600 text-gray-300',
};

type Props = {
  entityId: string;
  entityLabel?: string;
};

export function EntityReconciliationPanel({ entityId, entityLabel }: Props) {
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [decided, setDecided] = useState<Set<string>>(new Set());

  useEffect(() => { void loadCandidates(); }, [entityId]);

  async function loadCandidates() {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/entities/${encodeURIComponent(entityId)}/matches`, {
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      if (res.ok) {
        const body = await res.json() as { data: MatchCandidate[] };
        setCandidates(body.data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function decide(candidateId: string, decision: ReconciliationDecision) {
    setDecided((prev) => new Set([...prev, candidateId]));
    await fetch(`${BASE}/entities/${encodeURIComponent(entityId)}/reconciliation-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify({ targetId: candidateId, decision }),
    });
  }

  const pendingCandidates = candidates.filter((c) => !decided.has(c.candidateId));

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Cross-Connector Matches</h2>
          {entityLabel && <p className="text-xs text-gray-400 mt-0.5">For: {entityLabel}</p>}
        </div>
        {!loading && (
          <span className="text-xs text-gray-500">{pendingCandidates.length} pending</span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-6 text-gray-500 text-sm">Finding matches...</div>
      ) : pendingCandidates.length === 0 ? (
        <div className="text-center py-6 text-gray-500 text-sm">
          {candidates.length === 0 ? 'No match candidates found.' : 'All candidates reviewed.'}
        </div>
      ) : (
        <div className="space-y-3">
          {pendingCandidates.map((c) => (
            <div key={c.candidateId} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-100 truncate">{c.candidateId}</span>
                    <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">{c.candidateConnector}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>Confidence: {Math.round(c.confidence * 100)}%</span>
                    <span>Attr overlap: {Math.round(c.attributeOverlap * 100)}%</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-sm font-bold ${c.confidence >= 0.8 ? 'text-green-400' : c.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {Math.round(c.confidence * 100)}%
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 mb-3">
                {c.reasons.map((r, i) => (
                  <span key={i} className="text-xs text-gray-400 bg-gray-700 px-2 py-0.5 rounded-full">{r}</span>
                ))}
              </div>

              <div className="flex gap-2">
                {(['merge', 'link', 'reject'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => void decide(c.candidateId, d)}
                    className={`text-xs px-3 py-1.5 rounded transition-colors capitalize ${DECISION_STYLES[d]}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
