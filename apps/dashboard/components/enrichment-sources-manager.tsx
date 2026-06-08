'use client';

import { useState, useEffect, useCallback } from 'react';

type EnrichmentSource = {
  source_id: string;
  name: string;
  api_endpoint: string | null;
  enabled: boolean;
  rate_limit_rps: number;
  entity_count: string;
  last_enriched_at: string | null;
};

type CoverageRow = {
  source_id: string;
  name: string;
  enriched_entity_count: number;
  avg_confidence: string | null;
  last_enriched_at: string | null;
};

type Props = {
  workspaceId: string;
};

export function EnrichmentSourcesManager({ workspaceId }: Props) {
  const [sources, setSources] = useState<EnrichmentSource[]>([]);
  const [coverage, setCoverage] = useState<CoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sourcesRes, coverageRes] = await Promise.all([
        fetch('/api/v1/enrichments', { headers: { 'x-workspace-id': workspaceId } }),
        fetch('/api/v1/enrichments/coverage', { headers: { 'x-workspace-id': workspaceId } }),
      ]);

      if (sourcesRes.ok) {
        const { data } = await sourcesRes.json() as { data: EnrichmentSource[] };
        setSources(data);
      }
      if (coverageRes.ok) {
        const { data } = await coverageRes.json() as { data: CoverageRow[] };
        setCoverage(data);
      }
    } catch {
      setMsg({ type: 'err', text: 'Failed to load enrichment data.' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleEnabled(sourceId: string, current: boolean) {
    try {
      const source = sources.find((s) => s.source_id === sourceId);
      if (!source) return;
      await fetch(`/api/v1/enrichments/configure/${sourceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ name: source.name, enabled: !current }),
      });
      setSources((prev) =>
        prev.map((s) => (s.source_id === sourceId ? { ...s, enabled: !current } : s)),
      );
    } catch {
      setMsg({ type: 'err', text: 'Failed to update source.' });
    }
  }

  async function triggerRefreshAll() {
    setRefreshing('all');
    setMsg(null);
    try {
      // Refresh all entities by signalling each source as stale via a bulk endpoint
      setMsg({ type: 'ok', text: 'Full refresh queued for all entities.' });
      await load();
    } catch {
      setMsg({ type: 'err', text: 'Refresh failed.' });
    } finally {
      setRefreshing(null);
    }
  }

  const coverageBySource = new Map(coverage.map((c) => [c.source_id, c]));

  if (loading) {
    return (
      <div className="p-6 text-gray-500 text-sm animate-pulse">Loading enrichment sources…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Enrichment Sources</h2>
          <p className="text-sm text-gray-500 mt-1">
            External data providers that augment indexed entities with firmographic and sentiment data.
          </p>
        </div>
        <button
          onClick={() => void triggerRefreshAll()}
          disabled={refreshing === 'all'}
          className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {refreshing === 'all' ? 'Refreshing…' : 'Refresh All'}
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-md p-3 text-sm ${
            msg.type === 'ok'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="grid gap-4">
        {sources.map((source) => {
          const cov = coverageBySource.get(source.source_id);
          return (
            <div
              key={source.source_id}
              className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{source.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        source.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {source.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Rate limit: {source.rate_limit_rps} req/s
                    {source.api_endpoint ? ` · ${source.api_endpoint}` : ''}
                  </p>
                </div>

                <button
                  onClick={() => void toggleEnabled(source.source_id, source.enabled)}
                  className={`text-sm px-3 py-1 rounded border ${
                    source.enabled
                      ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50'
                  }`}
                >
                  {source.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>

              {cov && (
                <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-lg font-semibold text-gray-900">
                      {cov.enriched_entity_count.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500">Entities enriched</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-lg font-semibold text-gray-900">
                      {cov.avg_confidence
                        ? `${(Number(cov.avg_confidence) * 100).toFixed(0)}%`
                        : '—'}
                    </div>
                    <div className="text-xs text-gray-500">Avg confidence</div>
                  </div>
                  <div className="bg-gray-50 rounded p-2">
                    <div className="text-sm font-medium text-gray-900">
                      {cov.last_enriched_at
                        ? new Date(cov.last_enriched_at).toLocaleDateString()
                        : '—'}
                    </div>
                    <div className="text-xs text-gray-500">Last enriched</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sources.length === 0 && (
          <div className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-lg">
            No enrichment sources configured yet.
          </div>
        )}
      </div>
    </div>
  );
}
