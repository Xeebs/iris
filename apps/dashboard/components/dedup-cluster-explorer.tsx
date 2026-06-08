'use client';

import { useState, useEffect } from 'react';

type DedupCluster = {
  clusterId: string;
  entityType: string;
  memberCount: number;
  canonicalEntityId: string;
  avgSimilarity: number;
  mergedAt: string | null;
};

type SortField = 'memberCount' | 'avgSimilarity' | 'entityType';

type DedupClusterExplorerProps = {
  workspaceId: string;
  onSelectCluster: (clusterId: string) => void;
};

export function DedupClusterExplorer({ workspaceId, onSelectCluster }: DedupClusterExplorerProps) {
  const [clusters, setClusters] = useState<DedupCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('avgSimilarity');
  const [sortDesc, setSortDesc] = useState(true);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [showMerged, setShowMerged] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void loadClusters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function loadClusters() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (entityTypeFilter) params.set('entityType', entityTypeFilter);

      const res = await fetch(`/api/v1/admin/dedup/clusters?${params}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      const json = await res.json() as { data: DedupCluster[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Fetch failed');
      setClusters(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDesc((d) => !d);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  }

  const filtered = clusters
    .filter((c) => (showMerged ? true : !c.mergedAt))
    .filter((c) => !entityTypeFilter || c.entityType.includes(entityTypeFilter));

  const sorted = [...filtered].sort((a, b) => {
    const cmp =
      sortField === 'entityType'
        ? a.entityType.localeCompare(b.entityType)
        : (a[sortField] as number) - (b[sortField] as number);
    return sortDesc ? -cmp : cmp;
  });

  const entityTypes = Array.from(new Set(clusters.map((c) => c.entityType)));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Dedup Cluster Explorer</h3>
          <p className="text-xs text-gray-500 mt-0.5">{filtered.length} clusters</p>
        </div>
        <button
          onClick={() => void loadClusters()}
          disabled={loading}
          className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <select
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          className="text-xs px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          <option value="">All entity types</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showMerged}
            onChange={(e) => setShowMerged(e.target.checked)}
            className="rounded border-gray-300"
          />
          Show merged
        </label>
      </div>

      {error && (
        <div className="px-4 py-3 text-sm text-red-700 bg-red-50">{error}</div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 uppercase bg-gray-50">
            <tr>
              <th
                className="px-4 py-2 cursor-pointer hover:text-gray-700 select-none"
                onClick={() => toggleSort('entityType')}
              >
                Type {sortField === 'entityType' ? (sortDesc ? '↓' : '↑') : ''}
              </th>
              <th
                className="px-4 py-2 cursor-pointer hover:text-gray-700 select-none"
                onClick={() => toggleSort('memberCount')}
              >
                Members {sortField === 'memberCount' ? (sortDesc ? '↓' : '↑') : ''}
              </th>
              <th
                className="px-4 py-2 cursor-pointer hover:text-gray-700 select-none"
                onClick={() => toggleSort('avgSimilarity')}
              >
                Avg similarity {sortField === 'avgSimilarity' ? (sortDesc ? '↓' : '↑') : ''}
              </th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  No clusters found.
                </td>
              </tr>
            )}
            {sorted.map((cluster) => (
              <tr
                key={cluster.clusterId}
                className={`hover:bg-gray-50 cursor-pointer ${selectedId === cluster.clusterId ? 'bg-indigo-50' : ''}`}
                onClick={() => {
                  setSelectedId(cluster.clusterId);
                  onSelectCluster(cluster.clusterId);
                }}
              >
                <td className="px-4 py-2.5">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                    {cluster.entityType}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-medium">{cluster.memberCount}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`font-semibold ${
                      cluster.avgSimilarity >= 0.9
                        ? 'text-red-600'
                        : cluster.avgSimilarity >= 0.85
                          ? 'text-orange-500'
                          : 'text-yellow-600'
                    }`}
                  >
                    {(cluster.avgSimilarity * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {cluster.mergedAt ? (
                    <span className="text-xs text-gray-400">Merged</span>
                  ) : (
                    <span className="text-xs text-amber-600 font-medium">Pending</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(cluster.clusterId);
                      onSelectCluster(cluster.clusterId);
                    }}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
