'use client';

type VersionEntry = {
  snapshotId: string;
  snapshotKey: string;
  capturedAt: Date;
  entityCount: number;
  dataSizeBytes: number;
};

export default function VersionTimeline({
  versions,
  selectedId,
  onSelect,
}: {
  versions: VersionEntry[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {versions.map((v, i) => (
        <button
          key={v.snapshotId}
          onClick={() => onSelect(v.snapshotId)}
          className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
            selectedId === v.snapshotId
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-sm font-medium text-gray-900">{v.snapshotKey}</span>
            </div>
            <span className="text-xs text-gray-500">{v.capturedAt.toLocaleString()}</span>
          </div>
          <div className="mt-1 flex gap-4 text-xs text-gray-400">
            <span>{v.entityCount.toLocaleString()} entities</span>
            <span>{(v.dataSizeBytes / 1024).toFixed(0)} KB</span>
          </div>
        </button>
      ))}
    </div>
  );
}
