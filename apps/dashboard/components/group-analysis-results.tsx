'use client';

import { useState } from 'react';

type GroupCharacteristic = {
  attribute: string;
  commonValue: string | null;
  coverage: number;
  divergent: boolean;
};

type GroupAnalysis = {
  entityIds: string[];
  commonTypes: string[];
  characteristics: GroupCharacteristic[];
  gaps: string[];
  relationshipDensity: number;
};

type GroupAction = {
  action: 'bulk_link' | 'bulk_tag' | 'bulk_update_attribute' | 'review_duplicates';
  affectedEntityIds: string[];
  reason: string;
  priority: 'high' | 'medium' | 'low';
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

const ACTION_LABELS: Record<GroupAction['action'], string> = {
  bulk_link: 'Link Entities',
  bulk_tag: 'Tag Group',
  bulk_update_attribute: 'Update Attributes',
  review_duplicates: 'Review Duplicates',
};

const PRIORITY_STYLES: Record<GroupAction['priority'], string> = {
  high: 'text-red-400 bg-red-950 border-red-800',
  medium: 'text-yellow-400 bg-yellow-950 border-yellow-800',
  low: 'text-gray-400 bg-gray-800 border-gray-700',
};

type Props = {
  entityIds: string[];
};

export function GroupAnalysisResults({ entityIds }: Props) {
  const [analysis, setAnalysis] = useState<GroupAnalysis | null>(null);
  const [actions, setActions] = useState<GroupAction[]>([]);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    if (entityIds.length === 0) return;
    setLoading(true);
    try {
      const [analysisRes, actionsRes] = await Promise.all([
        fetch('/api/v1/batch/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
          body: JSON.stringify({ entityIds }),
        }),
        fetch('/api/v1/batch/group-actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
          body: JSON.stringify({ entityIds }),
        }),
      ]);
      if (analysisRes.ok) {
        const body = await analysisRes.json() as { data: GroupAnalysis };
        setAnalysis(body.data);
      }
      if (actionsRes.ok) {
        const body = await actionsRes.json() as { data: GroupAction[] };
        setActions(body.data);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Group Analysis</h3>
        <button
          onClick={() => void analyze()}
          disabled={loading || entityIds.length === 0}
          className="text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded transition-colors"
        >
          {loading ? 'Analyzing...' : 'Run Analysis'}
        </button>
      </div>

      {analysis && (
        <div className="space-y-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Entity Types</h4>
            <div className="flex flex-wrap gap-2">
              {analysis.commonTypes.map((t) => (
                <span key={t} className="text-sm text-gray-200 bg-gray-700 px-2.5 py-1 rounded-full capitalize">{t}</span>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Relationship Density</h4>
              <span className={`text-sm font-medium ${analysis.relationshipDensity > 0.5 ? 'text-green-400' : analysis.relationshipDensity > 0.2 ? 'text-yellow-400' : 'text-red-400'}`}>
                {Math.round(analysis.relationshipDensity * 100)}%
              </span>
            </div>
            <div className="bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${analysis.relationshipDensity > 0.5 ? 'bg-green-500' : analysis.relationshipDensity > 0.2 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.round(analysis.relationshipDensity * 100)}%` }}
              />
            </div>
          </div>

          {analysis.characteristics.length > 0 && (
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Attribute Coverage</h4>
              <div className="space-y-2">
                {analysis.characteristics.slice(0, 8).map((c) => (
                  <div key={c.attribute} className="flex items-center gap-3">
                    <span className="text-xs text-gray-300 w-32 truncate">{c.attribute}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${c.coverage >= 0.8 ? 'bg-green-500' : c.coverage >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${Math.round(c.coverage * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-right">{Math.round(c.coverage * 100)}%</span>
                    {c.divergent && <span className="text-xs text-yellow-400">divergent</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis.gaps.length > 0 && (
            <div className="bg-yellow-950 border border-yellow-800 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-yellow-400 mb-1">Data Gaps</h4>
              <p className="text-xs text-yellow-300">{analysis.gaps.join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Suggested Actions</h4>
          {actions.map((a, i) => (
            <div key={i} className={`border rounded-lg p-3 ${PRIORITY_STYLES[a.priority]}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">{ACTION_LABELS[a.action]}</span>
                <span className="text-xs capitalize">{a.priority}</span>
              </div>
              <p className="text-xs opacity-80">{a.reason}</p>
            </div>
          ))}
        </div>
      )}

      {!analysis && !loading && entityIds.length > 0 && (
        <p className="text-sm text-gray-500 text-center py-4">Click "Run Analysis" to analyze the selected group.</p>
      )}
    </div>
  );
}
