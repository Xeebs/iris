'use client';

import { useState } from 'react';

type Provider = 'gpt-4o' | 'gpt-4o-mini' | 'claude-3-5-sonnet' | 'claude-3-haiku';
type OutputFormat = 'json' | 'prose' | 'table' | 'bullets';

type OptimizationSuggestion = {
  id: string;
  description: string;
  estimatedSavingsPct: number;
  effort: 'low' | 'medium' | 'high';
};

type CostEstimate = {
  queryHash: string;
  provider: Provider;
  estimatedDeltaTokens: number;
  estimatedContextTokens: number;
  totalEstimatedCostCents: number;
  optimizationSuggestions: OptimizationSuggestion[];
  createdAt: string;
};

type CostHistoryEntry = {
  queryHash: string;
  provider: Provider;
  estimatedTokens: number;
  actualTokens: number | null;
  estimatedCostCents: number;
  createdAt: string;
};

const PROVIDER_LABELS: Record<Provider, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
  'claude-3-haiku': 'Claude Haiku',
};

const EFFORT_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-red-100 text-red-800',
};

type TokenBarProps = {
  deltaTokens: number;
  contextTokens: number;
};

function TokenBar({ deltaTokens, contextTokens }: TokenBarProps) {
  const total = deltaTokens + contextTokens;
  const deltaPct = total > 0 ? (deltaTokens / total) * 100 : 50;
  const contextPct = 100 - deltaPct;

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Delta (input): {deltaTokens.toLocaleString()} tokens</span>
        <span>Context (output): {contextTokens.toLocaleString()} tokens</span>
      </div>
      <div className="h-4 flex rounded overflow-hidden">
        <div
          className="bg-blue-400 transition-all"
          style={{ width: `${deltaPct}%` }}
          title={`Delta: ${deltaTokens} tokens (${deltaPct.toFixed(1)}%)`}
        />
        <div
          className="bg-purple-400 transition-all"
          style={{ width: `${contextPct}%` }}
          title={`Context: ${contextTokens} tokens (${contextPct.toFixed(1)}%)`}
        />
      </div>
      <div className="flex gap-4 text-xs text-gray-400 mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-blue-400 rounded-sm" /> Delta (query + embedding)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-purple-400 rounded-sm" /> Context delivery
        </span>
      </div>
    </div>
  );
}

type OptimizationListProps = {
  suggestions: OptimizationSuggestion[];
};

function OptimizationList({ suggestions }: OptimizationListProps) {
  if (suggestions.length === 0) {
    return <p className="text-sm text-gray-500 italic">No optimizations available for this query.</p>;
  }

  return (
    <ul className="space-y-2">
      {suggestions.map((s) => (
        <li key={s.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-medium text-gray-900">{s.description}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EFFORT_COLORS[s.effort] ?? ''}`}>
                {s.effort} effort
              </span>
              <span className="text-xs text-emerald-700 font-semibold">−{s.estimatedSavingsPct}% tokens</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

type HistoryTableProps = {
  entries: CostHistoryEntry[];
};

function HistoryTable({ entries }: HistoryTableProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500 text-center py-6">No cost history yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-500 uppercase bg-gray-50">
          <tr>
            <th className="px-4 py-2">Query hash</th>
            <th className="px-4 py-2">Provider</th>
            <th className="px-4 py-2">Est. tokens</th>
            <th className="px-4 py-2">Actual tokens</th>
            <th className="px-4 py-2">Est. cost</th>
            <th className="px-4 py-2">Accuracy</th>
            <th className="px-4 py-2">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {entries.map((e) => {
            const accuracy =
              e.actualTokens != null && e.estimatedTokens > 0
                ? Math.round((1 - Math.abs(e.actualTokens - e.estimatedTokens) / e.estimatedTokens) * 100)
                : null;

            return (
              <tr key={`${e.queryHash}-${e.provider}`} className="hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs text-gray-600">{e.queryHash.slice(0, 8)}…</td>
                <td className="px-4 py-2">{PROVIDER_LABELS[e.provider] ?? e.provider}</td>
                <td className="px-4 py-2">{e.estimatedTokens.toLocaleString()}</td>
                <td className="px-4 py-2">
                  {e.actualTokens != null ? e.actualTokens.toLocaleString() : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-4 py-2 font-medium">${(e.estimatedCostCents / 100).toFixed(4)}</td>
                <td className="px-4 py-2">
                  {accuracy != null ? (
                    <span className={accuracy >= 90 ? 'text-green-600' : accuracy >= 70 ? 'text-yellow-600' : 'text-red-600'}>
                      {accuracy}%
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {new Date(e.createdAt).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type QueryCostBreakdownProps = {
  workspaceId: string;
};

export function QueryCostBreakdown({ workspaceId }: QueryCostBreakdownProps) {
  const [tab, setTab] = useState<'estimator' | 'history'>('estimator');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<Provider>('gpt-4o-mini');
  const [entityCount, setEntityCount] = useState(20);
  const [format, setFormat] = useState<OutputFormat>('json');
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [history, setHistory] = useState<CostHistoryEntry[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runEstimate() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/queries/estimate-cost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ query, provider, entityCount, format }),
      });
      const json = await res.json() as { data: CostEstimate; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Estimation failed');
      setEstimate(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(cursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(`/api/v1/queries/cost-history?${params}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      const json = await res.json() as {
        data: CostHistoryEntry[];
        meta: { hasMore: boolean; nextCursor: string | null };
        error?: { message: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? 'Fetch failed');

      setHistory((prev) => (cursor ? [...prev, ...json.data] : json.data));
      setHistoryHasMore(json.meta.hasMore);
      setHistoryCursor(json.meta.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function handleTabChange(next: 'estimator' | 'history') {
    setTab(next);
    if (next === 'history' && history.length === 0) {
      void loadHistory();
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Query Cost Analysis</h2>
        <p className="text-sm text-gray-500 mt-0.5">Estimate token costs and get optimization recommendations</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-6">
        {(['estimator', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleTabChange(t)}
            className={`py-3 px-4 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {tab === 'estimator' && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Query</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                rows={3}
                placeholder="e.g. show me SaaS contacts with high ARR and their associated deals"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Entity count</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={entityCount}
                  onChange={(e) => setEntityCount(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Output format</label>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as OutputFormat)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {(['json', 'prose', 'table', 'bullets'] as const).map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => void runEstimate()}
              disabled={loading || !query.trim()}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Estimating…' : 'Estimate cost'}
            </button>

            {estimate && (
              <div className="space-y-5 pt-4 border-t border-gray-100">
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Total tokens</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(estimate.estimatedDeltaTokens + estimate.estimatedContextTokens).toLocaleString()}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Est. cost</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      ${(estimate.totalEstimatedCostCents / 100).toFixed(4)}
                    </p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Provider</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {PROVIDER_LABELS[estimate.provider]}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">Token breakdown</h3>
                  <TokenBar
                    deltaTokens={estimate.estimatedDeltaTokens}
                    contextTokens={estimate.estimatedContextTokens}
                  />
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    Optimization suggestions ({estimate.optimizationSuggestions.length})
                  </h3>
                  <OptimizationList suggestions={estimate.optimizationSuggestions} />
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-4">
            <HistoryTable entries={history} />
            {historyHasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => void loadHistory(historyCursor ?? undefined)}
                  disabled={loading}
                  className="px-4 py-2 text-sm text-indigo-600 border border-indigo-300 rounded-lg hover:bg-indigo-50 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
