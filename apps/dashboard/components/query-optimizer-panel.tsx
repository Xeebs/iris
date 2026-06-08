'use client';

import { useState, useEffect, useCallback } from 'react';

type ExecutionStrategy = 'vector_search_only' | 'graph_expansion_first' | 'cache_check_first' | 'parallel_hybrid';

type OptimizerStats = {
  totalPlans: number;
  strategyBreakdown: Record<ExecutionStrategy, number>;
  avgTokensSaved: number;
  avgLatencyImprovementMs: number;
  cacheHitRate: number;
  slowestQueries: Array<{ queryHash: string; avgLatencyMs: number; strategy: ExecutionStrategy }>;
};

type ExecutionPlan = {
  queryHash: string;
  strategy: ExecutionStrategy;
  steps: Array<{ stepId: string; description: string; estimatedTokens: number; estimatedLatencyMs: number }>;
  estimatedTotalTokens: number;
  estimatedTotalLatencyMs: number;
  reasoning: string;
};

const STRATEGY_LABELS: Record<ExecutionStrategy, string> = {
  vector_search_only: 'Vector Search',
  graph_expansion_first: 'Graph Expansion',
  cache_check_first: 'Cache First',
  parallel_hybrid: 'Parallel Hybrid',
};

const STRATEGY_COLORS: Record<ExecutionStrategy, string> = {
  vector_search_only: '#2563eb',
  graph_expansion_first: '#7c3aed',
  cache_check_first: '#16a34a',
  parallel_hybrid: '#ea580c',
};

/**
 * Dashboard panel showing query optimizer activity: strategy distribution, cost savings, and slowest queries.
 * @returns Rendered optimizer analytics panel
 */
export function QueryOptimizerPanel() {
  const [stats, setStats] = useState<OptimizerStats | null>(null);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/query-optimizer/stats');
      const json = await res.json() as { data?: OptimizerStats };
      setStats(json.data ?? null);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { void loadStats(); }, [loadStats]);

  const handleExplain = async () => {
    if (!query.trim()) { setError('Enter a query to explain'); return; }
    setLoading(true); setError(null); setPlan(null);
    try {
      const res = await fetch('/api/v1/queries/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), filters: {} }),
      });
      const json = await res.json() as { data?: ExecutionPlan; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed');
      setPlan(json.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to explain query'); }
    finally { setLoading(false); }
  };

  const totalPlans = stats?.totalPlans ?? 0;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Strategy breakdown */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Strategy Distribution</div>
          {stats ? (
            <div>
              {(Object.entries(stats.strategyBreakdown) as [ExecutionStrategy, number][]).map(([strategy, count]) => (
                <div key={strategy} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: STRATEGY_COLORS[strategy] }} />
                  <div style={{ flex: 1, fontSize: 12 }}>{STRATEGY_LABELS[strategy]}</div>
                  <div style={{ minWidth: 80 }}>
                    <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${totalPlans > 0 ? (count / totalPlans) * 100 : 0}%`, background: STRATEGY_COLORS[strategy], borderRadius: 4 }} />
                    </div>
                  </div>
                  <div style={{ color: '#6b7280', minWidth: 28, textAlign: 'right' }}>{count}</div>
                </div>
              ))}
            </div>
          ) : <div style={{ color: '#9ca3af' }}>No data yet.</div>}
        </div>

        {/* Cost / efficiency metrics */}
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Efficiency Metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              ['Total Plans', totalPlans.toLocaleString()],
              ['Cache Hit Rate', stats ? `${(stats.cacheHitRate * 100).toFixed(1)}%` : '—'],
              ['Avg Tokens Saved', stats ? stats.avgTokensSaved.toLocaleString() : '—'],
              ['Latency Saved (avg)', stats ? `${stats.avgLatencyImprovementMs}ms` : '—'],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: '8px 10px', background: '#f9fafb', borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Query explainer */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Query Plan Explainer</div>
        {error && <div style={{ padding: 8, background: '#fef2f2', borderRadius: 6, color: '#b91c1c', fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void handleExplain()}
            placeholder="Enter a query to see its execution plan…"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          />
          <button onClick={() => void handleExplain()} disabled={loading}
            style={{ padding: '7px 16px', background: loading ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? '…' : 'Explain'}
          </button>
        </div>
        {plan && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ padding: '3px 10px', background: '#eff6ff', color: STRATEGY_COLORS[plan.strategy], border: `1px solid #bfdbfe`, borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                {STRATEGY_LABELS[plan.strategy]}
              </span>
              <span style={{ color: '#6b7280', fontSize: 11 }}>~{plan.estimatedTotalTokens} tokens · ~{plan.estimatedTotalLatencyMs}ms</span>
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>{plan.reasoning}</div>
            <div>
              {plan.steps.map((step, i) => (
                <div key={step.stepId} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 12 }}>
                  <span style={{ color: '#9ca3af', minWidth: 16 }}>{i + 1}.</span>
                  <span style={{ flex: 1 }}>{step.description}</span>
                  <span style={{ color: '#6b7280' }}>{step.estimatedLatencyMs}ms</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Slowest queries */}
      {stats && stats.slowestQueries.length > 0 && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Slowest Queries</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                {['Query Hash', 'Strategy', 'Avg Latency'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.slowestQueries.map((q, i) => (
                <tr key={q.queryHash} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{q.queryHash}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{ color: STRATEGY_COLORS[q.strategy], fontWeight: 600 }}>{STRATEGY_LABELS[q.strategy]}</span>
                  </td>
                  <td style={{ padding: '6px 10px', color: q.avgLatencyMs > 1000 ? '#dc2626' : '#374151', fontWeight: q.avgLatencyMs > 1000 ? 700 : 400 }}>
                    {q.avgLatencyMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
