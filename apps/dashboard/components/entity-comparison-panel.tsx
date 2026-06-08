'use client';

type AttributeDiff = {
  field: string;
  value1: unknown;
  value2: unknown;
};

type EntitySnapshot = {
  entityId: string;
  entityType: string;
  label: string;
  attributes: Record<string, unknown>;
  sourceConnector: string;
  lastModified: string;
  completenessScore: number;
};

type EntityComparisonData = {
  entity1: EntitySnapshot;
  entity2: EntitySnapshot;
  matchingAttributes: string[];
  diffAttributes: AttributeDiff[];
  similarityScore: number;
  embeddingDistanceExplained: string;
};

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

type ComparisonRowProps = {
  field: string;
  value1: unknown;
  value2: unknown;
  isDiff: boolean;
};

function ComparisonRow({ field, value1, value2, isDiff }: ComparisonRowProps) {
  const rowClass = isDiff ? 'bg-yellow-50' : '';
  return (
    <tr className={rowClass}>
      <td className="px-3 py-2 text-xs font-medium text-gray-500 w-32 align-top">{field}</td>
      <td className={`px-3 py-2 text-sm align-top ${isDiff ? 'text-orange-700' : 'text-gray-900'}`}>
        {renderValue(value1)}
      </td>
      <td className={`px-3 py-2 text-sm align-top ${isDiff ? 'text-orange-700' : 'text-gray-900'}`}>
        {renderValue(value2)}
      </td>
    </tr>
  );
}

type EntityComparisonPanelProps = {
  comparison: EntityComparisonData;
  onApprove: (entity1Id: string, entity2Id: string, canonicalId: string) => void;
  onReject: (entity1Id: string, entity2Id: string) => void;
  loading?: boolean;
};

export function EntityComparisonPanel({
  comparison,
  onApprove,
  onReject,
  loading = false,
}: EntityComparisonPanelProps) {
  const { entity1, entity2, matchingAttributes, diffAttributes, similarityScore, embeddingDistanceExplained } =
    comparison;

  const allFields = Array.from(
    new Set([...Object.keys(entity1.attributes), ...Object.keys(entity2.attributes)]),
  );

  const diffSet = new Set(diffAttributes.map((d) => d.field));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Entity Comparison</h3>
          <p className="text-xs text-gray-500 mt-0.5">{embeddingDistanceExplained}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Similarity:</span>
          <span
            className={`text-sm font-bold ${
              similarityScore >= 0.85 ? 'text-red-600' : similarityScore >= 0.7 ? 'text-yellow-600' : 'text-green-600'
            }`}
          >
            {(similarityScore * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Entity headers */}
      <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200">
        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">Field</div>
        <div className="px-3 py-2 border-l border-gray-200">
          <div className="text-xs font-semibold text-gray-900 truncate">{entity1.label}</div>
          <div className="text-xs text-gray-400 truncate">via {entity1.sourceConnector}</div>
        </div>
        <div className="px-3 py-2 border-l border-gray-200">
          <div className="text-xs font-semibold text-gray-900 truncate">{entity2.label}</div>
          <div className="text-xs text-gray-400 truncate">via {entity2.sourceConnector}</div>
        </div>
      </div>

      {/* Completeness row */}
      <div className="grid grid-cols-3 border-b border-gray-100 bg-blue-50">
        <div className="px-3 py-1.5 text-xs font-medium text-blue-700">Completeness</div>
        <div className="px-3 py-1.5 text-xs text-blue-700 border-l border-blue-100">
          {(entity1.completenessScore * 100).toFixed(0)}%
        </div>
        <div className="px-3 py-1.5 text-xs text-blue-700 border-l border-blue-100">
          {(entity2.completenessScore * 100).toFixed(0)}%
        </div>
      </div>

      {/* Attribute rows */}
      <div className="overflow-y-auto max-h-72">
        <table className="w-full">
          <tbody className="divide-y divide-gray-100">
            {allFields.map((field) => (
              <ComparisonRow
                key={field}
                field={field}
                value1={entity1.attributes[field]}
                value2={entity2.attributes[field]}
                isDiff={diffSet.has(field)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary bar */}
      <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-200 flex items-center gap-4 text-xs text-gray-500">
        <span>
          <span className="font-medium text-green-700">{matchingAttributes.length}</span> matching
        </span>
        <span>
          <span className="font-medium text-yellow-700">{diffAttributes.length}</span> differ
        </span>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-3">
        <button
          onClick={() => onApprove(entity1.entityId, entity2.entityId, entity1.entityId)}
          disabled={loading}
          className="flex-1 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          Merge → {entity1.label}
        </button>
        <button
          onClick={() => onApprove(entity1.entityId, entity2.entityId, entity2.entityId)}
          disabled={loading}
          className="flex-1 py-2 text-sm font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
        >
          Merge → {entity2.label}
        </button>
        <button
          onClick={() => onReject(entity1.entityId, entity2.entityId)}
          disabled={loading}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Keep separate
        </button>
      </div>
    </div>
  );
}
