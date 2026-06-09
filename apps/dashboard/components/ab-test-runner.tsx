'use client';

import { useState, useEffect } from 'react';

type RetrievalStrategy = 'vector' | 'bm25' | 'hybrid';
type ExperimentStatus = 'running' | 'paused' | 'promoted' | 'abandoned';

type Experiment = {
  id: string;
  workspaceId: string;
  name: string;
  controlStrategy: RetrievalStrategy;
  treatmentStrategy: RetrievalStrategy;
  trafficPct: number;
  status: ExperimentStatus;
  winner: RetrievalStrategy | null;
  createdAt: string;
};

type MetricResult = {
  strategyName: string;
  metrics: {
    precisionAtK: number;
    recallAtK: number;
    ndcgAtK: number;
    mrr: number;
    sampleSize: number;
  };
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';
const BASE = '/api/v1/search-quality';

const STATUS_STYLES: Record<ExperimentStatus, string> = {
  running: 'text-green-400 bg-green-950 border-green-800',
  paused: 'text-yellow-400 bg-yellow-950 border-yellow-800',
  promoted: 'text-blue-400 bg-blue-950 border-blue-800',
  abandoned: 'text-gray-500 bg-gray-800 border-gray-700',
};

export function ABTestRunner() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [selectedExpId, setSelectedExpId] = useState<string | null>(null);
  const [results, setResults] = useState<MetricResult[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', control: 'vector' as RetrievalStrategy, treatment: 'hybrid' as RetrievalStrategy, traffic: 10 });

  useEffect(() => { void loadExperiments(); }, []);
  useEffect(() => { if (selectedExpId) void loadResults(selectedExpId); }, [selectedExpId]);

  async function loadExperiments() {
    const res = await fetch(`${BASE}/experiments?workspaceId=${encodeURIComponent(WORKSPACE_ID)}`, {
      headers: { 'x-workspace-id': WORKSPACE_ID },
    });
    if (res.ok) {
      const body = await res.json() as { data: Experiment[] };
      setExperiments(body.data);
    }
  }

  async function loadResults(expId: string) {
    const res = await fetch(`${BASE}/experiments/${encodeURIComponent(expId)}/results`, {
      headers: { 'x-workspace-id': WORKSPACE_ID },
    });
    if (res.ok) {
      const body = await res.json() as { data: { results: MetricResult[] } };
      setResults(body.data.results);
    }
  }

  async function createExperiment() {
    setCreating(true);
    try {
      const res = await fetch(`${BASE}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          name: form.name,
          controlStrategy: form.control,
          treatmentStrategy: form.treatment,
          trafficPct: form.traffic,
        }),
      });
      if (res.ok) {
        setForm({ name: '', control: 'vector', treatment: 'hybrid', traffic: 10 });
        await loadExperiments();
      }
    } finally {
      setCreating(false);
    }
  }

  async function promoteExperiment(expId: string, winner: RetrievalStrategy) {
    await fetch(`${BASE}/experiments/${encodeURIComponent(expId)}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, winner }),
    });
    await loadExperiments();
  }

  const strategies: RetrievalStrategy[] = ['vector', 'bm25', 'hybrid'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3">New Experiment</h3>
          <div className="space-y-3">
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Experiment name"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Control</label>
                <select value={form.control} onChange={(e) => setForm((f) => ({ ...f, control: e.target.value as RetrievalStrategy }))} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-100">
                  {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Treatment</label>
                <select value={form.treatment} onChange={(e) => setForm((f) => ({ ...f, treatment: e.target.value as RetrievalStrategy }))} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-100">
                  {strategies.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Traffic to treatment: {form.traffic}%</label>
              <input type="range" min={1} max={50} value={form.traffic} onChange={(e) => setForm((f) => ({ ...f, traffic: Number(e.target.value) }))} className="w-full" />
            </div>
            <button
              onClick={() => void createExperiment()}
              disabled={creating || !form.name}
              className="w-full text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded transition-colors"
            >
              {creating ? 'Creating...' : 'Create Experiment'}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {experiments.map((exp) => (
            <button
              key={exp.id}
              onClick={() => setSelectedExpId(exp.id)}
              className={`w-full text-left bg-gray-900 border rounded-lg p-3 transition-colors hover:bg-gray-800 ${selectedExpId === exp.id ? 'border-blue-500' : 'border-gray-700'}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-gray-100 truncate">{exp.name}</span>
                <span className={`text-xs border rounded px-1.5 py-0.5 ${STATUS_STYLES[exp.status]}`}>{exp.status}</span>
              </div>
              <div className="text-xs text-gray-500">{exp.controlStrategy} vs {exp.treatmentStrategy} · {exp.trafficPct}%</div>
            </button>
          ))}
          {experiments.length === 0 && <p className="text-sm text-gray-500 text-center py-4">No experiments yet.</p>}
        </div>
      </div>

      <div className="lg:col-span-2 bg-gray-900 border border-gray-700 rounded-xl p-5">
        {selectedExpId ? (
          <>
            <h3 className="text-sm font-semibold text-white mb-4">Experiment Results</h3>
            {results.length === 0 ? (
              <p className="text-sm text-gray-500">No results recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-800">
                      <th className="pb-2 text-left">Strategy</th>
                      <th className="pb-2 text-right">P@5</th>
                      <th className="pb-2 text-right">R@10</th>
                      <th className="pb-2 text-right">NDCG</th>
                      <th className="pb-2 text-right">MRR</th>
                      <th className="pb-2 text-right">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.strategyName} className="border-b border-gray-800">
                        <td className="py-2 text-gray-200 capitalize">{r.strategyName}</td>
                        <td className="py-2 text-right text-gray-300">{r.metrics.precisionAtK.toFixed(3)}</td>
                        <td className="py-2 text-right text-gray-300">{r.metrics.recallAtK.toFixed(3)}</td>
                        <td className="py-2 text-right text-gray-300">{r.metrics.ndcgAtK.toFixed(3)}</td>
                        <td className="py-2 text-right text-gray-300">{r.metrics.mrr.toFixed(3)}</td>
                        <td className="py-2 text-right text-gray-400">{r.metrics.sampleSize}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {experiments.find((e) => e.id === selectedExpId)?.status === 'running' && (
              <div className="flex gap-2 mt-4 pt-4 border-t border-gray-700">
                {(['vector', 'bm25', 'hybrid'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => void promoteExperiment(selectedExpId, s)}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded transition-colors"
                  >
                    Promote {s}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-gray-500 text-sm">Select an experiment to view results.</div>
        )}
      </div>
    </div>
  );
}
