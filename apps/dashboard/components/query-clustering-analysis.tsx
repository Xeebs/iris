'use client';

import { useState } from 'react';

type QueryCluster = {
  clusterId: string;
  workspaceId: string;
  clusterSignature: string;
  memberCount: number;
  dominantEntityTypes: string[];
  updateFrequencyPercentile: number;
  optimalTtlSeconds: number;
  confidenceScore: number;
  createdAt: string;
};

type QueryClusteringAnalysisProps = {
  workspaceId: string;
  initialClusters?: QueryCluster[];
};

function formatTtl(seconds: number): string {
  if (seconds >= 86400) return `${seconds / 3600}h`;
  if (seconds >= 3600) return `${seconds / 3600}h`;
  if (seconds >= 60) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function ttlColor(seconds: number): string {
  if (seconds >= 86400) return 'text-green-700 bg-green-50 border-green-200';
  if (seconds >= 3600) return 'text-blue-700 bg-blue-50 border-blue-200';
  return 'text-orange-700 bg-orange-50 border-orange-200';
}

function VelocityBar({ percentile }: { percentile: number }) {
  const color = percentile < 20 ? 'bg-green-400' : percentile < 60 ? 'bg-blue-400' : 'bg-orange-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${percentile}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{percentile}%</span>
    </div>
  );
}

function ConfidenceDot({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-600">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      {pct}%
    </span>
  );
}

export function QueryClusteringAnalysis({ workspaceId, initialClusters = [] }: QueryClusteringAnalysisProps) {
  const [clusters, setClusters] = useState<QueryCluster[]>(initialClusters);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchClusters(days = 7) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/cache/clusters?days=${days}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: QueryCluster[] };
      setClusters(body.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clusters');
    } finally {
      setLoading(false);
    }
  }

  const selectedCluster = clusters.find(c => c.clusterId === selected);

  const ttlBuckets = {
    '24h+': clusters.filter(c => c.optimalTtlSeconds >= 86400).length,
    '1h': clusters.filter(c => c.optimalTtlSeconds >= 3600 && c.optimalTtlSeconds < 86400).length,
    '<1h': clusters.filter(c => c.optimalTtlSeconds < 3600).length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Query Cluster Analysis</h2>
          <p className="text-xs text-gray-500 mt-0.5">Semantic query groups with adaptive cache TTL</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => fetchClusters(d)}
              disabled={loading}
              className="text-xs px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* TTL distribution summary */}
      {clusters.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(ttlBuckets).map(([label, count]) => (
            <div key={label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-xl font-bold text-gray-800">{count}</div>
              <div className="text-xs text-gray-500 mt-0.5">TTL {label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cluster list */}
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          {clusters.length === 0 && !loading ? (
            <div className="py-10 text-center text-sm text-gray-400">
              No clusters found.{' '}
              <button onClick={() => fetchClusters()} className="underline hover:text-gray-600">
                Run analysis
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {clusters.map(c => (
                <li
                  key={c.clusterId}
                  onClick={() => setSelected(c.clusterId === selected ? null : c.clusterId)}
                  className={`px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${c.clusterId === selected ? 'bg-indigo-50 border-l-2 border-indigo-400' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {c.dominantEntityTypes.slice(0, 3).map(t => (
                          <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{t}</span>
                        ))}
                        <span className="text-xs text-gray-400">{c.memberCount} queries</span>
                      </div>
                      <VelocityBar percentile={c.updateFrequencyPercentile} />
                    </div>
                    <div className="shrink-0">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${ttlColor(c.optimalTtlSeconds)}`}>
                        {formatTtl(c.optimalTtlSeconds)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Cluster detail */}
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          {selectedCluster ? (
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Cluster Detail</h3>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Members</span>
                  <span className="font-medium">{selectedCluster.memberCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Optimal TTL</span>
                  <span className={`font-medium ${selectedCluster.optimalTtlSeconds >= 86400 ? 'text-green-700' : selectedCluster.optimalTtlSeconds >= 3600 ? 'text-blue-700' : 'text-orange-700'}`}>
                    {formatTtl(selectedCluster.optimalTtlSeconds)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Confidence</span>
                  <ConfidenceDot score={selectedCluster.confidenceScore} />
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Update velocity</span>
                  <span className="text-gray-700">{selectedCluster.updateFrequencyPercentile}th pct.</span>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Entity types</div>
                <div className="flex flex-wrap gap-1">
                  {selectedCluster.dominantEntityTypes.map(t => (
                    <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">{t}</span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 mb-1">Update frequency</div>
                <VelocityBar percentile={selectedCluster.updateFrequencyPercentile} />
              </div>

              <div className="pt-1 text-xs text-gray-400">
                Computed {new Date(selectedCluster.createdAt).toLocaleDateString()}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-gray-400 py-10">
              Select a cluster to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
