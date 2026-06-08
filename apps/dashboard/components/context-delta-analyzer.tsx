'use client';

import { useState, useEffect } from 'react';

type DeltaEntry = {
  clientId: string;
  deltaId: string;
  entitiesAddedCount: number;
  entitiesRemovedCount: number;
  entitiesModifiedCount: number;
  savedTokens: number;
  streamChunks: number;
  deliveredAt: string;
};

type HistoryResponse = {
  data: DeltaEntry[];
  meta: { hasMore: boolean; nextCursor: string | null };
};

type ContextDeltaAnalyzerProps = {
  workspaceId: string;
  clientId: string;
};

function TokenSavingsBar({ savedTokens, totalNew }: { savedTokens: number; totalNew: number }) {
  const total = savedTokens + totalNew;
  const pct = total === 0 ? 0 : Math.round((savedTokens / total) * 100);
  const color = pct >= 60 ? 'bg-green-400' : pct >= 30 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-gray-700 w-10 text-right">{pct}%</span>
    </div>
  );
}

function SummaryCard({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-0.5">{value}</div>
      {sublabel && <div className="text-xs text-gray-400 mt-0.5">{sublabel}</div>}
    </div>
  );
}

export function ContextDeltaAnalyzer({ workspaceId, clientId }: ContextDeltaAnalyzerProps) {
  const [entries, setEntries] = useState<DeltaEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchHistory(nextCursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (nextCursor) params.set('cursor', nextCursor);
      const res = await fetch(
        `/api/v1/mcp-clients/${clientId}/context-history?${params}`,
        { headers: { 'x-workspace-id': workspaceId } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as HistoryResponse;
      setEntries(prev => nextCursor ? [...prev, ...body.data] : body.data);
      setHasMore(body.meta.hasMore);
      setCursor(body.meta.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchHistory(); }, [clientId, workspaceId]);

  async function resetClientState() {
    const res = await fetch(`/api/v1/mcp-clients/${clientId}/state`, {
      method: 'DELETE',
      headers: { 'x-workspace-id': workspaceId },
    });
    if (res.ok) { setEntries([]); setHasMore(false); setCursor(null); }
  }

  const totalSaved = entries.reduce((s, e) => s + e.savedTokens, 0);
  const totalDelivered = entries.reduce((s, e) => s + e.entitiesAddedCount + e.entitiesModifiedCount, 0);
  const avgChunks = entries.length === 0 ? 0 : (entries.reduce((s, e) => s + e.streamChunks, 0) / entries.length).toFixed(1);
  const fullContextCost = entries.reduce((s, e) => s + e.savedTokens + e.entitiesAddedCount * 50 + e.entitiesModifiedCount * 50, 0);
  const overallSavingsPct = fullContextCost === 0 ? 0 : Math.round((totalSaved / fullContextCost) * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Context Delta Analyzer</h2>
          <p className="text-xs text-gray-500 mt-0.5">Token savings from incremental MCP context delivery for <code className="font-mono">{clientId}</code></p>
        </div>
        <button
          onClick={() => void resetClientState()}
          className="text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50"
        >
          Reset State
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Tokens Saved" value={totalSaved.toLocaleString()} sublabel="vs full context" />
        <SummaryCard label="Overall Savings" value={`${overallSavingsPct}%`} sublabel="of total context cost" />
        <SummaryCard label="Entities Delta'd" value={totalDelivered} sublabel="added + modified" />
        <SummaryCard label="Avg Chunks/Delta" value={avgChunks} sublabel="stream chunks" />
      </div>

      {error && (
        <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
      )}

      {/* Delta history table */}
      {entries.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Time', '+Added', '-Removed', '~Modified', 'Tokens Saved', 'Chunks', 'Savings'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {entries.map(e => {
                const total = e.savedTokens + (e.entitiesAddedCount + e.entitiesModifiedCount) * 50;
                const totalNew = (e.entitiesAddedCount + e.entitiesModifiedCount) * 50;
                return (
                  <tr key={e.deltaId} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 font-mono">
                      {new Date(e.deliveredAt).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-2 text-green-700 font-medium">+{e.entitiesAddedCount}</td>
                    <td className="px-3 py-2 text-red-600 font-medium">-{e.entitiesRemovedCount}</td>
                    <td className="px-3 py-2 text-yellow-700 font-medium">~{e.entitiesModifiedCount}</td>
                    <td className="px-3 py-2 text-gray-900 font-medium">{e.savedTokens.toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-500">{e.streamChunks}</td>
                    <td className="px-3 py-2 w-32">
                      <TokenSavingsBar savedTokens={e.savedTokens} totalNew={totalNew} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length === 0 && !loading && (
        <div className="text-center py-8 text-sm text-gray-400">
          No delta history yet — context deltas will appear here after the client makes queries.
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => void fetchHistory(cursor ?? undefined)}
          disabled={loading}
          className="w-full text-sm py-2 border border-gray-200 rounded-md text-gray-500 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
