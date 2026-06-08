'use client';

import { useEffect, useState } from 'react';
import { ConnectorCostChart } from './connector-cost-chart.js';
import { RoiScatterplot } from './roi-scatterplot.js';

interface ConnectorCostSummary {
  connectorId: string;
  entityCount: number;
  indexCostCents: number;
  queryCostCents: number;
  totalCostCents: number;
  tokensSpent: number;
  tokensSaved: number;
  queryCount: number;
  roiScore: number;
}

interface CostRecommendation {
  type: string;
  connectorId: string;
  title: string;
  description: string;
  estimatedSavingsCentsPerMonth: number;
}

interface CostBreakdownReport {
  totalCostCents: number;
  connectors: ConnectorCostSummary[];
  recommendations: CostRecommendation[];
}

interface ConnectorCostBreakdownProps {
  workspaceId: string;
  apiBase?: string;
}

type SortMode = 'cost' | 'roi' | 'queries';

export function ConnectorCostBreakdown({
  workspaceId,
  apiBase = '/api/v1',
}: ConnectorCostBreakdownProps) {
  const [data, setData] = useState<CostBreakdownReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>('cost');

  useEffect(() => {
    setLoading(true);
    fetch(`${apiBase}/billing/connectors`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: CostBreakdownReport }>;
      })
      .then((body) => { setData(body.data); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [apiBase, workspaceId]);

  if (loading) {
    return <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>Loading connector costs…</div>;
  }

  if (error || !data) {
    return <div style={{ padding: '1rem', color: '#dc2626', fontSize: '0.875rem' }}>{error ?? 'No data'}</div>;
  }

  const totalDollars = (data.totalCostCents / 100).toFixed(4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Cost by Connector</h3>
          <div style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>
            Total: ${totalDollars} · {data.connectors.length} connectors
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['cost', 'roi', 'queries'] as SortMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setSortBy(mode)}
              style={{
                padding: '0.25rem 0.625rem',
                fontSize: '0.75rem',
                borderRadius: '0.375rem',
                border: '1px solid',
                borderColor: sortBy === mode ? '#3b82f6' : '#e2e8f0',
                background: sortBy === mode ? '#eff6ff' : 'white',
                color: sortBy === mode ? '#1d4ed8' : '#64748b',
                cursor: 'pointer',
                fontWeight: sortBy === mode ? 600 : 400,
              }}
            >
              By {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      <ConnectorCostChart connectors={data.connectors} sortBy={sortBy} />

      {/* ROI scatterplot */}
      {data.connectors.length >= 2 && (
        <div>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            ROI Overview (Cost vs. Queries/$)
          </h4>
          <RoiScatterplot connectors={data.connectors} />
        </div>
      )}

      {/* Recommendations */}
      {data.recommendations.length > 0 && (
        <div>
          <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Cost Optimization Recommendations
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {data.recommendations.map((rec, i) => (
              <li
                key={i}
                style={{
                  padding: '0.875rem',
                  borderRadius: '0.5rem',
                  border: '1px solid #e2e8f0',
                  background: '#fafafa',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem' }}>{rec.title}</div>
                  <div style={{ fontSize: '0.8125rem', color: '#64748b' }}>{rec.description}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#16a34a' }}>
                    Save ~${(rec.estimatedSavingsCentsPerMonth / 100).toFixed(2)}/mo
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{rec.type}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
