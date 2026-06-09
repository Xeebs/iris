'use client';

import { useState, useEffect } from 'react';

type ExperimentSummary = {
  id: string;
  name: string;
  controlStrategy: string;
  treatmentStrategy: string;
  status: string;
  winner: string | null;
  createdAt: string;
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color = value > 0.7 ? 'bg-green-500' : value > 0.4 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300">{pct}%</span>
      </div>
      <div className="bg-gray-700 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function QualityMetricsDashboard() {
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/search-quality/experiments?workspaceId=${encodeURIComponent(WORKSPACE_ID)}`, {
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      if (res.ok) {
        const body = await res.json() as { data: ExperimentSummary[] };
        setExperiments(body.data);
      }
    } finally {
      setLoading(false);
    }
  }

  const running = experiments.filter((e) => e.status === 'running').length;
  const promoted = experiments.filter((e) => e.status === 'promoted').length;
  const total = experiments.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-white">{total}</div>
          <div className="text-xs text-gray-400 mt-1">Total Experiments</div>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-green-400">{running}</div>
          <div className="text-xs text-gray-400 mt-1">Running</div>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-400">{promoted}</div>
          <div className="text-xs text-gray-400 mt-1">Promoted</div>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Retrieval Quality Benchmarks</h3>
        <div className="space-y-4">
          <MetricBar label="Target Precision@5" value={0.7} />
          <MetricBar label="Target Recall@10" value={0.8} />
          <MetricBar label="Target NDCG@5" value={0.75} />
          <MetricBar label="Target MRR" value={0.85} />
        </div>
        <p className="text-xs text-gray-500 mt-3">Targets based on embedding-patterns.md thresholds. Run A/B experiments to compare actual vs. target.</p>
      </div>

      {loading ? (
        <div className="text-sm text-gray-500 text-center py-6">Loading experiments...</div>
      ) : experiments.length > 0 ? (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Recent Experiments</h3>
          <div className="space-y-2">
            {experiments.slice(0, 8).map((exp) => (
              <div key={exp.id} className="flex items-center justify-between p-3 bg-gray-800 border border-gray-700 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-200">{exp.name}</div>
                  <div className="text-xs text-gray-500">{exp.controlStrategy} vs {exp.treatmentStrategy}</div>
                </div>
                <div className="text-right">
                  <div className={`text-xs font-medium capitalize ${exp.status === 'running' ? 'text-green-400' : exp.status === 'promoted' ? 'text-blue-400' : 'text-gray-500'}`}>
                    {exp.status}
                  </div>
                  {exp.winner && <div className="text-xs text-gray-400">Winner: {exp.winner}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-8 text-center text-gray-500 text-sm">
          No experiments yet. Go to A/B Tests to create your first experiment.
        </div>
      )}
    </div>
  );
}
