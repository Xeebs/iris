'use client';

import { useState } from 'react';

type EntityContext = {
  entityId: string;
  entityType: string;
  label: string;
  relevanceScore: number;
  sharedWith: string[];
};

type PerEntityRecommendation = {
  entityId: string;
  contexts: EntityContext[];
  topAttributes: string[];
};

type SharedContext = {
  contextId: string;
  entityIds: string[];
  relevanceScore: number;
  description: string;
};

type BatchResult = {
  sessionId: string;
  perEntity: PerEntityRecommendation[];
  sharedContexts: SharedContext[];
  generatedAt: string;
};

const WORKSPACE_ID = process.env['NEXT_PUBLIC_IRIS_WORKSPACE_ID'] ?? 'default';

type Props = {
  selectedEntityIds: string[];
  onSessionCreated?: (sessionId: string) => void;
};

export function BatchContextPanel({ selectedEntityIds, onSessionCreated }: Props) {
  const [result, setResult] = useState<BatchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'per-entity' | 'shared'>('per-entity');

  async function runBatch() {
    if (selectedEntityIds.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/batch/recommend-contexts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': WORKSPACE_ID },
        body: JSON.stringify({ entityIds: selectedEntityIds, topK: 10 }),
      });
      if (res.ok) {
        const body = await res.json() as { data: BatchResult };
        setResult(body.data);
        onSessionCreated?.(body.data.sessionId);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-white">Batch Context Recommendations</h2>
          <p className="text-xs text-gray-400 mt-0.5">{selectedEntityIds.length} entities selected</p>
        </div>
        <button
          onClick={() => void runBatch()}
          disabled={loading || selectedEntityIds.length === 0}
          className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded transition-colors"
        >
          {loading ? 'Analyzing...' : 'Analyze Batch'}
        </button>
      </div>

      {selectedEntityIds.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">Select entities to analyze as a group.</div>
      )}

      {result && (
        <>
          <div className="flex border-b border-gray-700 mb-4">
            {(['per-entity', 'shared'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${activeTab === tab ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {tab === 'per-entity' ? 'Per Entity' : `Shared (${result.sharedContexts.length})`}
              </button>
            ))}
          </div>

          {activeTab === 'per-entity' && (
            <div className="space-y-4">
              {result.perEntity.map((rec) => (
                <div key={rec.entityId} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-gray-100 truncate">{rec.entityId}</span>
                    <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded capitalize">{rec.topAttributes[0] ?? 'entity'}</span>
                  </div>
                  {rec.contexts.length === 0 ? (
                    <p className="text-xs text-gray-500">No context recommendations found.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {rec.contexts.slice(0, 5).map((ctx) => (
                        <div key={ctx.entityId} className="flex items-center justify-between text-xs">
                          <span className="text-gray-300 truncate">{ctx.label || ctx.entityId}</span>
                          <div className="flex items-center gap-2 ml-2 shrink-0">
                            {ctx.sharedWith.length > 0 && (
                              <span className="text-blue-400">shared</span>
                            )}
                            <span className="text-gray-500">{Math.round(ctx.relevanceScore * 100)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'shared' && (
            <div className="space-y-2">
              {result.sharedContexts.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">No shared contexts found across the group.</div>
              ) : (
                result.sharedContexts.map((ctx) => (
                  <div key={ctx.contextId} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-100 truncate">{ctx.contextId}</span>
                      <span className="text-xs text-blue-400">{Math.round(ctx.relevanceScore * 100)}% shared</span>
                    </div>
                    <p className="text-xs text-gray-400">{ctx.description}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ctx.entityIds.map((eid) => (
                        <span key={eid} className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded truncate max-w-[100px]">{eid}</span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
