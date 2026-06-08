'use client';

import { useState, useEffect } from 'react';

type WarmingJob = {
  entityIds: string[];
  loadedCount: number;
  ttlSeconds: number;
  warmedAt: string;
};

type CoOccurrence = {
  entityTypeA: string;
  entityTypeB: string;
  coOccurrenceScore: number;
};

type Props = {
  workspaceId: string;
  onPreload?: (entityIds: string[]) => void;
};

export function CacheWarmingStatus({ workspaceId, onPreload }: Props) {
  const [latestJob, setLatestJob] = useState<WarmingJob | null>(null);
  const [patterns, setPatterns] = useState<CoOccurrence[]>([]);
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    async function loadPatterns() {
      try {
        const res = await fetch(`/api/v1/cache/patterns?workspaceId=${workspaceId}`);
        if (res.ok) {
          const data = await res.json() as { data: CoOccurrence[] };
          setPatterns(data.data.slice(0, 5));
        }
      } catch { /* silent */ }
    }
    void loadPatterns();
  }, [workspaceId]);

  async function triggerPrewarm() {
    setWarming(true);
    try {
      // Predict context for a generic query to get entity IDs to prewarm
      const predictRes = await fetch('/api/v1/cache/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, query: 'find contacts deals', entityIds: [] }),
      });
      if (!predictRes.ok) return;
      const { data: predicted } = await predictRes.json() as { data: { entityIds: string[] } };

      if (predicted.entityIds.length > 0) {
        const preloadRes = await fetch('/api/v1/cache/preload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, entityIds: predicted.entityIds.slice(0, 20), ttlSeconds: 300 }),
        });
        if (preloadRes.ok) {
          const { data: job } = await preloadRes.json() as { data: WarmingJob };
          setLatestJob({ ...job, warmedAt: new Date().toISOString() });
          onPreload?.(job.entityIds);
        }
      }
    } finally {
      setWarming(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Cache Warming Status</h3>
        <button
          onClick={triggerPrewarm}
          disabled={warming}
          className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {warming ? 'Warming...' : 'Prewarm Now'}
        </button>
      </div>

      {latestJob && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
          <div className="flex items-center gap-2 text-blue-700 font-medium">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            Last warming job
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-blue-600">
            <div><span className="font-medium">{latestJob.loadedCount}</span> entities loaded</div>
            <div>TTL: <span className="font-medium">{latestJob.ttlSeconds}s</span></div>
            <div>{new Date(latestJob.warmedAt).toLocaleTimeString()}</div>
          </div>
        </div>
      )}

      {patterns.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-600 mb-2">Top Co-occurrence Patterns</p>
          <div className="space-y-1">
            {patterns.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-gray-700">
                  <span className="font-medium">{p.entityTypeA}</span>
                  {p.entityTypeA !== p.entityTypeB && <> + <span className="font-medium">{p.entityTypeB}</span></>}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min(100, p.coOccurrenceScore * 200)}%` }}
                    />
                  </div>
                  <span className="text-gray-500">{Math.round(p.coOccurrenceScore * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {patterns.length === 0 && !warming && (
        <p className="text-xs text-gray-400 text-center py-2">
          No patterns yet — run more queries to enable predictive prewarming
        </p>
      )}
    </div>
  );
}
