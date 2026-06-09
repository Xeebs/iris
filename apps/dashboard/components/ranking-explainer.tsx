'use client';

import { useState } from 'react';

type RankedResult = {
  rank: number;
  entityId: string;
  entityLabel: string;
  precisionAtK: number;
  recallAtK: number;
  ndcgAtK: number;
  mrr: number;
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

export function RankingExplainer() {
  const [retrievedIds, setRetrievedIds] = useState('');
  const [expectedIds, setExpectedIds] = useState('');
  const [k, setK] = useState(5);
  const [results, setResults] = useState<{ precisionAtK: number; recallAtK: number; ndcgAtK: number; mrr: number; sampleSize: number } | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  async function evaluate() {
    const retrieved = retrievedIds.split(',').map((s) => s.trim()).filter(Boolean);
    const expected = expectedIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (!retrieved.length || !expected.length) return;

    setEvaluating(true);
    try {
      const res = await fetch('/api/v1/search-quality/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({ retrievedIds: retrieved, expectedIds: expected, k }),
      });
      if (res.ok) {
        const body = await res.json() as { data: typeof results };
        setResults(body.data);
      }
    } finally {
      setEvaluating(false);
    }
  }

  const retrieved = retrievedIds.split(',').map((s) => s.trim()).filter(Boolean);
  const expected = new Set(expectedIds.split(',').map((s) => s.trim()).filter(Boolean));

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Evaluate a Ranking</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Retrieved IDs (comma-separated, ordered)</label>
            <textarea
              value={retrievedIds}
              onChange={(e) => setRetrievedIds(e.target.value)}
              rows={3}
              placeholder="entity_1, entity_2, entity_3, ..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Expected IDs (relevant ground truth)</label>
            <textarea
              value={expectedIds}
              onChange={(e) => setExpectedIds(e.target.value)}
              rows={3}
              placeholder="entity_1, entity_3, ..."
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">K =</label>
            <input
              type="number"
              value={k}
              onChange={(e) => setK(Number(e.target.value))}
              min={1}
              max={20}
              className="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={() => void evaluate()}
            disabled={evaluating || !retrievedIds || !expectedIds}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded transition-colors"
          >
            {evaluating ? 'Evaluating...' : 'Evaluate'}
          </button>
        </div>
      </div>

      {retrieved.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Result List Breakdown</h3>
          <div className="space-y-1.5">
            {retrieved.map((id, i) => {
              const isRelevant = expected.has(id);
              const isInTopK = i < k;
              return (
                <div key={id} className={`flex items-center gap-3 p-2 rounded ${isRelevant ? 'bg-green-950 border border-green-800' : 'bg-gray-800 border border-gray-700'}`}>
                  <span className={`text-xs font-mono w-6 text-center ${isInTopK ? 'text-white' : 'text-gray-600'}`}>#{i + 1}</span>
                  <span className="text-sm text-gray-200 flex-1 truncate">{id}</span>
                  {isRelevant && <span className="text-xs text-green-400 shrink-0">relevant</span>}
                  {!isInTopK && <span className="text-xs text-gray-600 shrink-0">past K</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {results && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Metrics at K={k}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Precision@K', value: results.precisionAtK, desc: 'Relevant in top K' },
              { label: 'Recall@K', value: results.recallAtK, desc: 'Found of all relevant' },
              { label: 'NDCG@K', value: results.ndcgAtK, desc: 'Rank quality score' },
              { label: 'MRR', value: results.mrr, desc: 'Mean reciprocal rank' },
            ].map((m) => (
              <div key={m.label} className="bg-gray-800 rounded-lg p-3 text-center">
                <div className={`text-2xl font-bold mb-1 ${m.value > 0.7 ? 'text-green-400' : m.value > 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {m.value.toFixed(3)}
                </div>
                <div className="text-xs font-medium text-gray-300">{m.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{m.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
