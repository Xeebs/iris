'use client';

import { useState } from 'react';

type StrategyScore = {
  strategy: string;
  score: number;
  estimatedLatencyP95Ms: number;
  estimatedTokens: number;
  estimatedCost: number;
  pros: string[];
  cons: string[];
};

type QueryPlan = {
  planId: string;
  strategy: string;
  connectors: string[];
  estimatedLatencyP95Ms: number;
  estimatedTokens: number;
  estimatedCost: number;
  strategyRankings: StrategyScore[];
  reasoning: string;
};

type ConnectorInput = {
  connectorId: string;
  entityTypes: string[];
  avgLatencyMs: number;
  cacheHitRate: number;
  costPerRequest: number;
};

const STRATEGY_COLORS: Record<string, string> = {
  parallel: '#3b82f6',
  sequential: '#f59e0b',
  'filtered-first': '#10b981',
  'cached-first': '#8b5cf6',
};

export function QueryStrategyAnalyzer() {
  const [query, setQuery] = useState('');
  const [connectorInput, setConnectorInput] = useState('hubspot,salesforce');
  const [plan, setPlan] = useState<QueryPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function parseConnectors(): ConnectorInput[] {
    return connectorInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({
        connectorId: id,
        entityTypes: ['contact', 'company', 'deal'],
        avgLatencyMs: 200,
        cacheHitRate: 0.35,
        costPerRequest: 2,
      }));
  }

  async function analyzePlan() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/query-optimizer/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          connectors: parseConnectors(),
          persist: true,
        }),
      });
      const json = await res.json() as { data: QueryPlan; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Unknown error');
      setPlan(json.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const maxLatency = plan
    ? Math.max(...plan.strategyRankings.map((r) => r.estimatedLatencyP95Ms), 1)
    : 1;

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Query Strategy Analyzer</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Business query (e.g. 'show all contacts with open deals')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && analyzePlan()}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
        />
        <button
          onClick={analyzePlan}
          disabled={loading || !query.trim()}
          style={{
            padding: '8px 16px',
            background: loading ? '#9ca3af' : '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
          Connectors (comma-separated)
        </label>
        <input
          type="text"
          value={connectorInput}
          onChange={(e) => setConnectorInput(e.target.value)}
          style={{ width: '100%', padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        />
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#dc2626', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {plan && (
        <div>
          {/* Recommendation badge */}
          <div style={{
            padding: 16,
            background: '#f0f9ff',
            border: `2px solid ${STRATEGY_COLORS[plan.strategy] ?? '#3b82f6'}`,
            borderRadius: 8,
            marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                padding: '2px 10px',
                background: STRATEGY_COLORS[plan.strategy] ?? '#3b82f6',
                color: '#fff',
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 600,
              }}>
                {plan.strategy}
              </span>
              <span style={{ fontSize: 13, color: '#374151' }}>Recommended</span>
            </div>
            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>{plan.reasoning}</div>
            <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
              <span><b>p95 Latency:</b> {plan.estimatedLatencyP95Ms}ms</span>
              <span><b>Tokens:</b> {plan.estimatedTokens.toLocaleString()}</span>
              <span><b>Cost:</b> {plan.estimatedCost.toFixed(2)}</span>
              <span><b>Connectors:</b> {plan.connectors.join(', ')}</span>
            </div>
          </div>

          {/* Cost vs Latency chart */}
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Strategy Comparison</h3>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Strategy</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Score</th>
                  <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Latency p95</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Tokens</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {plan.strategyRankings.map((r, i) => (
                  <tr key={r.strategy} style={{ background: r.strategy === plan.strategy ? '#eff6ff' : i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{
                        display: 'inline-block',
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: STRATEGY_COLORS[r.strategy] ?? '#9ca3af',
                        marginRight: 6,
                      }} />
                      {r.strategy}
                      {r.strategy === plan.strategy && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: '#3b82f6', fontWeight: 600 }}>✓</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{r.score.toFixed(3)}</td>
                    <td style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                          <div style={{
                            width: `${(r.estimatedLatencyP95Ms / maxLatency) * 100}%`,
                            background: STRATEGY_COLORS[r.strategy] ?? '#9ca3af',
                            height: '100%',
                            borderRadius: 4,
                          }} />
                        </div>
                        <span style={{ whiteSpace: 'nowrap', minWidth: 50, textAlign: 'right' }}>{r.estimatedLatencyP95Ms}ms</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{r.estimatedTokens.toLocaleString()}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{r.estimatedCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pros / cons for winning strategy */}
          {(() => {
            const winner = plan.strategyRankings.find((r) => r.strategy === plan.strategy);
            if (!winner) return null;
            return (
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{ flex: 1, padding: 12, background: '#f0fdf4', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#15803d', marginBottom: 6 }}>Pros</div>
                  {winner.pros.map((p) => <div key={p} style={{ fontSize: 13, color: '#374151' }}>✓ {p}</div>)}
                </div>
                <div style={{ flex: 1, padding: 12, background: '#fef2f2', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#dc2626', marginBottom: 6 }}>Cons</div>
                  {winner.cons.map((c) => <div key={c} style={{ fontSize: 13, color: '#374151' }}>✗ {c}</div>)}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
