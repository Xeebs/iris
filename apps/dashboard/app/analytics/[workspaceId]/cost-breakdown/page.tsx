'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ConnectorCostChart } from '../../../../components/connector-cost-chart.js';
import { RoiScatterplot } from '../../../../components/roi-scatterplot.js';

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
  type: 'disable_low_roi' | 'consolidate_overlap' | 'archive_stale';
  connectorId: string;
  title: string;
  description: string;
  estimatedSavingsCentsPerMonth: number;
}

interface CostBreakdownReport {
  workspaceId: string;
  periodStart: string;
  periodEnd: string;
  totalCostCents: number;
  connectors: ConnectorCostSummary[];
  recommendations: CostRecommendation[];
}

type SortBy = 'cost' | 'roi' | 'queries';

const API_URL =
  typeof process !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1')
    : '/api/v1';

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`;
}

function recommendationBadgeColor(type: CostRecommendation['type']): string {
  if (type === 'disable_low_roi') return '#ef4444';
  if (type === 'archive_stale') return '#f59e0b';
  return '#6366f1';
}

export default function CostBreakdownPage({
  params,
}: {
  params: { workspaceId: string };
}): React.JSX.Element {
  const { workspaceId } = params;

  const [report, setReport] = useState<CostBreakdownReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('cost');
  const [dismissedRecs, setDismissedRecs] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const qs = new URLSearchParams({
        workspaceId,
        periodStart: start.toISOString(),
        periodEnd: now.toISOString(),
      });
      const res = await fetch(`${API_URL}/billing/connectors?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: CostBreakdownReport };
      setReport(body.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost breakdown');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const activeRecs = report?.recommendations.filter(
    (r) => !dismissedRecs.has(r.connectorId + r.type),
  ) ?? [];

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Link href="/" className="hover:text-gray-700">Dashboard</Link>
          <span>/</span>
          <Link href="/analytics" className="hover:text-gray-700">Analytics</Link>
          <span>/</span>
          <span className="text-gray-700">Cost Breakdown</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Connector Cost Breakdown</h1>
        <p className="mt-1 text-sm text-gray-500 font-mono">{workspaceId}</p>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Cost</p>
          <p className="text-2xl font-bold tabular-nums mt-1">
            {report ? centsToDollars(report.totalCostCents) : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">30-day period</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Connectors</p>
          <p className="text-2xl font-bold tabular-nums mt-1">{report?.connectors.length ?? '—'}</p>
          <p className="text-xs text-gray-400 mt-0.5">active this period</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Recommendations</p>
          <p className="text-2xl font-bold tabular-nums mt-1 text-amber-600">{activeRecs.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">cost savings available</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded mb-6">{error}</div>
      )}

      {/* Recommendations panel */}
      {activeRecs.length > 0 && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg p-5">
          <h2 className="text-base font-semibold text-amber-900 mb-3">Cost Optimization Recommendations</h2>
          <div className="flex flex-col gap-3">
            {activeRecs.map((rec) => (
              <div key={rec.connectorId + rec.type} className="flex items-start gap-3 bg-white rounded-md border border-amber-100 p-3">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full text-white mt-0.5 whitespace-nowrap"
                  style={{ background: recommendationBadgeColor(rec.type) }}
                >
                  {rec.type.replace(/_/g, ' ')}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{rec.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{rec.description}</p>
                  <p className="text-xs text-green-700 mt-1 font-medium">
                    Est. saving: {centsToDollars(rec.estimatedSavingsCentsPerMonth)}/mo
                  </p>
                </div>
                <button
                  onClick={() =>
                    setDismissedRecs((prev) => new Set([...prev, rec.connectorId + rec.type]))
                  }
                  className="text-xs text-gray-400 hover:text-gray-600 ml-2 shrink-0"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cost bar chart */}
      <div className="bg-white border rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">Cost per Connector</h2>
          <div className="flex gap-2">
            {(['cost', 'roi', 'queries'] as SortBy[]).map((s) => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  sortBy === s
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                Sort by {s}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <ConnectorCostChart connectors={report?.connectors ?? []} sortBy={sortBy} />
        )}
      </div>

      {/* ROI scatterplot */}
      <div className="bg-white border rounded-lg p-6">
        <h2 className="text-base font-semibold text-gray-800 mb-1">ROI Scatterplot</h2>
        <p className="text-xs text-gray-500 mb-4">x = total cost · y = queries per dollar (higher = better value)</p>
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <RoiScatterplot connectors={report?.connectors ?? []} />
        )}
      </div>
    </main>
  );
}
