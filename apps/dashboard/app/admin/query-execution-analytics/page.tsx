'use client';

import { useEffect, useState } from 'react';
import { QueryPlanDiagram } from '../../../../components/query-plan-diagram.js';
import { StrategyMatrix } from '../../../../components/strategy-matrix.js';
import { ConnectorHeatmap } from '../../../../components/connector-heatmap.js';

type Plan = {
  planId: string;
  query: string;
  strategy: string;
  connectors: string[];
  estimatedLatencyMs: number;
  estimatedTokenCost: number;
  strategyRankings: Array<{ strategy: string; estimatedLatencyMs: number; estimatedTokenCost: number; overallScore: number; pros: string[]; cons: string[] }>;
  createdAt: string;
  executionResults?: Array<{
    resultId: string;
    actualLatencyMs: number;
    actualTokenCost: number;
    strategyUsed: string;
    connectorTimings: Record<string, number>;
    cacheHits: number;
    executedAt: string;
  }>;
};

type Tab = 'plans' | 'strategy-comparison' | 'affinity' | 'anomalies';

export default function QueryExecutionAnalyticsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchPlans();
  }, []);

  async function fetchPlans() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/query-analytics/plans', {
        headers: { 'x-workspace-id': 'current' },
      });
      if (res.ok) {
        const body = (await res.json()) as { data: Plan[] };
        setPlans(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function selectPlan(planId: string) {
    const res = await fetch(`/api/v1/query-analytics/plans/${planId}`, {
      headers: { 'x-workspace-id': 'current' },
    });
    if (res.ok) {
      const body = (await res.json()) as { data: Plan };
      setSelectedPlan(body.data);
    }
  }

  async function rerunPlan(planId: string, strategy: string) {
    await fetch(`/api/v1/query-analytics/plans/${planId}/rerun`, {
      method: 'POST',
      body: JSON.stringify({ strategy, dryRun: false }),
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'current' },
    });
    await fetchPlans();
  }

  // Compute affinity data from plans
  const topicCounts: Record<string, Record<string, number>> = {};
  for (const plan of plans) {
    const topic = plan.query.split(' ').slice(0, 2).join(' ');
    if (!topicCounts[topic]) topicCounts[topic] = {};
    for (const c of plan.connectors) {
      topicCounts[topic][c] = (topicCounts[topic][c] ?? 0) + 1;
    }
  }
  const heatmapCells = Object.entries(topicCounts).flatMap(([topic, connMap]) =>
    Object.entries(connMap).map(([connectorId, selectionCount]) => ({ topic, connectorId, selectionCount }))
  );
  const allTopics = Array.from(new Set(heatmapCells.map((c) => c.topic)));
  const allConnectors = Array.from(new Set(heatmapCells.map((c) => c.connectorId)));

  // Detect anomalies: actual latency >> estimated
  const anomalies = plans.filter((p) => {
    const results = p.executionResults ?? [];
    return results.some((r) => r.actualLatencyMs > p.estimatedLatencyMs * 2);
  });

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 1100 }}>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.25rem', fontWeight: 700 }}>Query Execution Analytics</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '2px solid #e5e7eb' }}>
        {([
          ['plans', 'Execution Plans'],
          ['strategy-comparison', 'Strategy Comparison'],
          ['affinity', 'Connector Affinity'],
          ['anomalies', 'Anomalies'],
        ] as [Tab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab ? '#3b82f6' : '#6b7280', fontWeight: activeTab === tab ? 600 : 400,
              fontSize: '0.875rem', marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : (
        <>
          {activeTab === 'plans' && (
            <div style={{ display: 'grid', gridTemplateColumns: selectedPlan ? '1fr 1fr' : '1fr', gap: '1rem' }}>
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: 600 }}>Query</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: 600 }}>Strategy</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: 600 }}>Est. ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => (
                      <tr
                        key={p.planId}
                        onClick={() => void selectPlan(p.planId)}
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          cursor: 'pointer',
                          background: selectedPlan?.planId === p.planId ? '#eff6ff' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.4rem 0.75rem', color: '#111827', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.query}
                        </td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#6b7280' }}>{p.strategy}</td>
                        <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right', color: '#374151' }}>{p.estimatedLatencyMs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plans.length === 0 && <p style={{ color: '#9ca3af', padding: '1rem' }}>No execution plans yet.</p>}
              </div>

              {selectedPlan && (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem' }}>
                  <div style={{ fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.75rem', fontFamily: 'monospace' }}>
                    {selectedPlan.query}
                  </div>
                  <QueryPlanDiagram
                    strategy={selectedPlan.strategy}
                    connectors={selectedPlan.connectors}
                    estimatedLatencyMs={selectedPlan.estimatedLatencyMs}
                    connectorTimings={selectedPlan.executionResults?.[0]?.connectorTimings}
                    cacheHits={selectedPlan.executionResults?.[0]?.cacheHits}
                  />
                  {selectedPlan.strategyRankings?.length > 0 && (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Rerun with strategy:</div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {(['parallel', 'sequential', 'filtered-first', 'cached-first'] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => void rerunPlan(selectedPlan.planId, s)}
                            style={{ padding: '0.3rem 0.75rem', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: '0.8125rem' }}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'strategy-comparison' && plans.length > 0 && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: '0.875rem' }}>
                Strategy Comparison Matrix
              </div>
              <StrategyMatrix
                strategies={plans[0]!.strategyRankings ?? []}
                selectedStrategy={plans[0]!.strategy}
              />
            </div>
          )}

          {activeTab === 'affinity' && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem' }}>Connector Affinity Heatmap</div>
              <ConnectorHeatmap cells={heatmapCells} topics={allTopics} connectors={allConnectors} />
            </div>
          )}

          {activeTab === 'anomalies' && (
            <div>
              {anomalies.length === 0 ? (
                <p style={{ color: '#22c55e' }}>No anomalies detected. All plans are performing within expected latency bounds.</p>
              ) : (
                anomalies.map((p) => (
                  <div key={p.planId} style={{ border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '0.5rem', background: '#fef2f2' }}>
                    <div style={{ fontWeight: 600, color: '#dc2626', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                      Latency anomaly — actual 2× higher than estimated
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: '#374151' }}>{p.query}</div>
                    <div style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
                      Strategy: {p.strategy} · Est: {p.estimatedLatencyMs}ms
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
