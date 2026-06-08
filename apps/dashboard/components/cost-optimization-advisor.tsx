'use client';

import { useState, useEffect } from 'react';
import { CostBreakdownChart } from './cost-breakdown-chart';
import { RecommendationCard } from './recommendation-card';

interface CostBreakdown {
  byConnector: Array<{ connectorId: string; tokensSpent: number; pctOfTotal: number }>;
  byEntityType: Array<{ entityType: string; tokensSpent: number; pctOfTotal: number }>;
  weekOverWeekChange: number;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  estimatedSavingsCostMonthly: number;
  implementationEffort: 'low' | 'medium' | 'high';
  appliedAt: string | null;
}

interface CostOptimizationAdvisorProps {
  apiBase?: string;
}

/**
 * Admin dashboard panel for cost attribution and optimization recommendations.
 */
export function CostOptimizationAdvisor({ apiBase = '/api/v1' }: CostOptimizationAdvisorProps) {
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [days, setDays] = useState('30');

  useEffect(() => {
    void fetchData();
  }, [days]);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [bdRes, recRes] = await Promise.all([
        fetch(`${apiBase}/cost-analytics/breakdown?days=${days}`),
        fetch(`${apiBase}/cost-analytics/recommendations?days=${days}`),
      ]);

      if (bdRes.ok) {
        const body = (await bdRes.json()) as { data: CostBreakdown };
        setBreakdown(body.data);
      }
      if (recRes.ok) {
        const body = (await recRes.json()) as { data: Recommendation[] };
        setRecommendations(body.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost data');
    } finally {
      setLoading(false);
    }
  }

  async function handleApply(id: string) {
    setApplying(id);
    try {
      const res = await fetch(`${apiBase}/cost-analytics/recommendations/${id}/apply`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setApplying(null);
    }
  }

  const connectorChartData = (breakdown?.byConnector ?? []).map((c) => ({
    name: c.connectorId.slice(0, 16),
    value: c.tokensSpent,
    pct: c.pctOfTotal,
  }));

  const entityTypeChartData = (breakdown?.byEntityType ?? []).map((t) => ({
    name: t.entityType,
    value: t.tokensSpent,
    pct: t.pctOfTotal,
  }));

  const wowChange = breakdown?.weekOverWeekChange ?? 0;
  const lowEffortRecs = recommendations.filter((r) => r.implementationEffort === 'low' && !r.appliedAt);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#111827', margin: 0 }}>
            Cost Optimization Advisor
          </h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
            Token cost attribution and automated recommendations.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          style={{ padding: '0.375rem 0.625rem', border: '1px solid #e2e8f0', borderRadius: '0.375rem', fontSize: '0.875rem' }}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {/* Cost alert */}
      {wowChange > 20 && (
        <div style={{ padding: '0.875rem 1.25rem', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#854d0e', fontWeight: 600 }}>
            Token costs increased {wowChange.toFixed(1)}% week-over-week. Review recommendations below.
          </p>
        </div>
      )}

      {error && (
        <div style={{ padding: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.375rem', color: '#dc2626', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {loading && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Loading…</p>}

      {!loading && breakdown && (
        <>
          {/* Low-effort quick actions */}
          {lowEffortRecs.length > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.5rem', padding: '1rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#1e40af' }}>
                {lowEffortRecs.length} quick win{lowEffortRecs.length !== 1 ? 's' : ''} available — low effort, high impact
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {lowEffortRecs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => void handleApply(r.id)}
                    disabled={applying === r.id}
                    style={{ padding: '0.375rem 0.875rem', background: '#2563eb', color: 'white', border: 'none', borderRadius: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {applying === r.id ? 'Applying…' : r.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cost breakdown charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1.25rem', background: 'white' }}>
              <CostBreakdownChart data={connectorChartData} title="Cost by Connector" />
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '1.25rem', background: 'white' }}>
              <CostBreakdownChart data={entityTypeChartData} title="Cost by Entity Type" />
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.75rem' }}>
              Recommendations ({recommendations.length})
            </h3>
            {recommendations.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                No recommendations at this time. Your spend patterns look healthy.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    {...rec}
                    onApply={handleApply}
                    applying={applying === rec.id}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
