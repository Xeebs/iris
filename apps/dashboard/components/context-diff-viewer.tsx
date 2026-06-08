'use client';

type ChangeType = 'created' | 'updated' | 'deleted';

type DiffSummary = {
  created: number;
  updated: number;
  deleted: number;
  totalChanges: number;
};

type VersionDiff = {
  fromVersionId: string;
  toVersionId: string;
  changedEntityIds: string[];
  changeTypes: ChangeType[];
  diffSummary: DiffSummary;
};

const CHANGE_COLORS: Record<ChangeType, string> = {
  created: 'bg-green-100 text-green-800',
  updated: 'bg-yellow-100 text-yellow-800',
  deleted: 'bg-red-100 text-red-800',
};

export default function ContextDiffViewer({ diff }: { diff: VersionDiff | null }) {
  if (!diff) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">
        Select two versions to compare.
      </div>
    );
  }

  const { changedEntityIds, changeTypes, diffSummary } = diff;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Created', count: diffSummary.created, color: 'text-green-600' },
          { label: 'Updated', count: diffSummary.updated, color: 'text-yellow-600' },
          { label: 'Deleted', count: diffSummary.deleted, color: 'text-red-600' },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-3 text-center">
            <p className={`text-xl font-semibold ${stat.color}`}>{stat.count}</p>
            <p className="text-xs text-gray-500">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold text-gray-600">
          Changed Entities ({diffSummary.totalChanges})
        </div>
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
          {changedEntityIds.map((entityId, i) => (
            <div key={entityId} className="flex items-center gap-3 px-4 py-2.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${CHANGE_COLORS[changeTypes[i] ?? 'updated']}`}>
                {changeTypes[i] ?? 'updated'}
              </span>
              <code className="text-xs text-gray-700">{entityId}</code>
            </div>
          ))}
          {changedEntityIds.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">No changes between these versions.</div>
          )}
        </div>
      </div>
    </div>
  );
}
