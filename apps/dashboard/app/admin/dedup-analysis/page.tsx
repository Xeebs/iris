'use client';

import { useState } from 'react';
import { DedupClusterExplorer } from '../../../components/dedup-cluster-explorer.js';
import { EntityComparisonPanel } from '../../../components/entity-comparison-panel.js';

type EntitySnapshot = {
  entityId: string;
  entityType: string;
  label: string;
  attributes: Record<string, unknown>;
  sourceConnector: string;
  lastModified: string;
  completenessScore: number;
  similarityToCanonical: number;
};

type EntityComparisonData = {
  entity1: EntitySnapshot;
  entity2: EntitySnapshot;
  matchingAttributes: string[];
  diffAttributes: Array<{ field: string; value1: unknown; value2: unknown }>;
  similarityScore: number;
  embeddingDistanceExplained: string;
};

type ClusterMember = EntitySnapshot;

const WORKSPACE_ID = process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default';

export default function DedupAnalysisPage() {
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [members, setMembers] = useState<ClusterMember[]>([]);
  const [comparison, setComparison] = useState<EntityComparisonData | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [loadingMerge, setLoadingMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  async function handleSelectCluster(clusterId: string) {
    setSelectedClusterId(clusterId);
    setComparison(null);
    setLoadingMembers(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/admin/dedup/clusters/${clusterId}/members`, {
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      const json = await res.json() as { data: ClusterMember[]; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Fetch failed');
      setMembers(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingMembers(false);
    }
  }

  async function handleCompare(id1: string, id2: string) {
    setLoadingComparison(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/dedup/compare?entity1=${id1}&entity2=${id2}`, {
        headers: { 'x-workspace-id': WORKSPACE_ID },
      });
      const json = await res.json() as { data: EntityComparisonData; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Fetch failed');
      setComparison(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingComparison(false);
    }
  }

  async function handleApprove(entity1Id: string, entity2Id: string, canonicalId: string) {
    setLoadingMerge(true);
    try {
      const res = await fetch('/api/v1/admin/dedup/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({ entity1Id, entity2Id, canonicalId }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: { message: string } };
        throw new Error(json.error?.message ?? 'Merge failed');
      }
      setComparison(null);
      showToast('Entities merged successfully.');
      if (selectedClusterId) await handleSelectCluster(selectedClusterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingMerge(false);
    }
  }

  function handleReject(_entity1Id: string, _entity2Id: string) {
    setComparison(null);
    showToast('Entities marked as separate.');
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Deduplication Analysis</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review clusters of similar entities and approve or reject suggested merges.
        </p>
      </div>

      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 px-4 py-3 bg-green-600 text-white text-sm rounded-lg shadow-lg">
          {toastMsg}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: Cluster list */}
        <DedupClusterExplorer workspaceId={WORKSPACE_ID} onSelectCluster={handleSelectCluster} />

        {/* Right: Members + comparison */}
        <div className="space-y-4">
          {selectedClusterId && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-900">Cluster Members</h3>
                <p className="text-xs text-gray-500">Select two entities to compare</p>
              </div>

              {loadingMembers ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500">Loading members…</div>
              ) : members.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-500">No members found.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {members.map((m, i) => (
                    <li key={m.entityId} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{m.label}</div>
                        <div className="text-xs text-gray-500">
                          via {m.sourceConnector} · {(m.completenessScore * 100).toFixed(0)}% complete
                        </div>
                      </div>
                      {i < members.length - 1 && (
                        <button
                          onClick={() => void handleCompare(m.entityId, members[i + 1]!.entityId)}
                          disabled={loadingComparison}
                          className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                        >
                          Compare with next
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {loadingComparison && (
            <div className="py-8 text-center text-sm text-gray-500">Loading comparison…</div>
          )}

          {comparison && !loadingComparison && (
            <EntityComparisonPanel
              comparison={comparison}
              onApprove={handleApprove}
              onReject={handleReject}
              loading={loadingMerge}
            />
          )}

          {!selectedClusterId && (
            <div className="flex items-center justify-center h-48 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-sm text-gray-400">
              Select a cluster to review its members
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
