'use client';

import { useState, useEffect, useCallback } from 'react';
import { RecommendationActionCard } from './recommendation-action-card.js';

interface CostRecommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  estimatedSavingsTokensPerDay: number;
  estimatedSavingsCostMonthly: number;
  implementationEffort: 'low' | 'medium' | 'high';
  appliedAt: string | null;
  savingsRealizedCents: number;
}

interface SpendSummary {
  totalCostCents: number;
  cacheHitRate: number;
  compressionEfficiency: number;
  tokensPerDay: number;
  windowDays: number;
}

interface CostOptimizerResponse {
  data: {
    spendSummary: SpendSummary;
    recommendations: CostRecommendation[];
  };
}

interface CostOptimizerPanelProps {
  workspaceId: string;
  windowDays?: number;
  apiBase?: string;
}

export function CostOptimizerPanel({
  workspaceId,
  windowDays = 30,
  apiBase = '/api/v1',
}: CostOptimizerPanelProps) {
  const [data, setData] = useState<CostOptimizerResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/cost-optimizer/recommendations?workspaceId=${encodeURIComponent(workspaceId)}&windowDays=${windowDays}`,
        { credentials: 'include' },
      );
      const json = await res.json() as CostOptimizerResponse;
      if (!res.ok) throw new Error('Failed to load recommendations');
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  }, [apiBase, workspaceId, windowDays]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleApply = useCallback(async (id: string) => {
    setApplying(id);
    try {
      const res = await fetch(`${apiBase}/cost-optimizer/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recommendationId: id }),
      });
      if (res.ok) {
        setApplied((prev) => new Set([...prev, id]));
      }
    } finally {
      setApplying(null);
    }
  }, [apiBase]);

  const handleApplyAllLowEffort = useCallback(async () => {
    if (!data) return;
    const lowEffortRecs = data.recommendations.filter(
      (r) => r.implementationEffort === 'low' && !r.appliedAt && !applied.has(r.id),
    );
    for (const rec of lowEffortRecs) {
      await handleApply(rec.id);
    }
  }, [data, applied, handleApply]);

  if (loading) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
        Loading cost recommendations…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '1rem', background: '#fef2f2', borderRadius: '0.5rem', color: '#dc2626', fontSize: '0.875rem' }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const topRecs = data.recommendations.slice(0, 3);
  const lowEffortCount = data.recommendations.filter(
    (r) => r.implementationEffort === 'low' && !r.appliedAt && !applied.has(r.id),
  ).length;
  const totalSavingsMonthly = data.recommendations.reduce(
    (sum, r) => sum + r.estimatedSavingsCostMonthly,
    0,
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '1.25rem',
        background: 'white',
        borderRadius: '0.75rem',
        border: '1px solid #e2e8f0',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a' }}>
            Cost Optimizer
          </h3>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            {data.spendSummary.windowDays}-day analysis · {Math.round(data.spendSummary.cacheHitRate * 100)}% cache hit rate
          </p>
        </div>
        {totalSavingsMonthly > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#16a34a' }}>
              ${(totalSavingsMonthly / 100).toFixed(0)}/mo
            </div>
            <div style={{ fontSize: '0.6875rem', color: '#64748b' }}>potential savings</div>
          </div>
        )}
      </div>

      {/* Quick action button */}
      {lowEffortCount > 0 && (
        <button
          onClick={() => { void handleApplyAllLowEffort(); }}
          disabled={applying !== null}
          style={{
            padding: '0.5rem 1rem',
            background: '#f0fdf4',
            color: '#16a34a',
            border: '1px solid #bbf7d0',
            borderRadius: '0.5rem',
            fontSize: '0.8125rem',
            fontWeight: 600,
            cursor: applying ? 'not-allowed' : 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          Apply all {lowEffortCount} low-effort {lowEffortCount === 1 ? 'recommendation' : 'recommendations'}
        </button>
      )}

      {/* Top recommendations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {topRecs.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b', textAlign: 'center', padding: '1rem' }}>
            No recommendations at this time — your spend looks well optimized!
          </p>
        ) : (
          topRecs.map((rec) => (
            <RecommendationActionCard
              key={rec.id}
              {...rec}
              appliedAt={applied.has(rec.id) ? new Date().toISOString() : rec.appliedAt}
              onApply={handleApply}
              applying={applying === rec.id}
            />
          ))
        )}
      </div>

      {data.recommendations.length > 3 && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
          +{data.recommendations.length - 3} more recommendations available
        </p>
      )}
    </div>
  );
}
