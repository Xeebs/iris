'use client';

import { useState, useEffect, useCallback } from 'react';
import { use } from 'react';
import Link from 'next/link';

import { CompositionCharts } from '../../../../../components/composition-charts.js';
import { FreshnessTimeline } from '../../../../../components/freshness-timeline.js';
import { QualityScorecard } from '../../../../../components/quality-scorecard.js';

interface PageProps {
  params: Promise<{ workspaceId: string }>;
}

interface CompositionReport {
  composition: {
    workspaceId: string;
    totalEntities: number;
    byEntityType: Array<{ entityType: string; count: number; storageBytesEstimate: number }>;
    byConnector: Array<{ connectorId: string; entityCount: number; pctOfTotal: number }>;
    snapshotAt: string;
  };
  freshness: {
    workspaceId: string;
    pctUpdatedLast7Days: number;
    pctUpdatedLast30Days: number;
    avgAgeByType: Record<string, number>;
    lastSyncByConnector: Record<string, string>;
  };
  quality: {
    pctWithRelationships: number;
    avgRelationshipDensity: number;
    embeddingCoveragePct: number;
    dedupRatioLast30Days: number;
  } | null;
  opportunities: Array<{
    id: string;
    type: 'dedup' | 'archive_connector' | 'prune_stale' | 'index_rebalance';
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    estimatedMonthlySavingsCents: number;
  }>;
}

interface Snapshot {
  date: string;
  totalEntities: number;
}

function LoadingCard() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
      <div className="mt-4 h-32 animate-pulse rounded bg-gray-50" />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <span>{message}</span>
      <button type="button" onClick={onRetry} className="ml-4 font-medium underline hover:no-underline">
        Retry
      </button>
    </div>
  );
}

/**
 * Index Composition & Insights page for a workspace.
 * Shows entity type distribution, connector contributions, freshness trends, quality metrics,
 * and optimization recommendations.
 */
export default function CompositionPage({ params }: PageProps) {
  const { workspaceId } = use(params);
  const [report, setReport] = useState<CompositionReport | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [reportRes, snapshotRes] = await Promise.all([
        fetch(`/api/v1/analytics/index?workspaceId=${encodeURIComponent(workspaceId)}`),
        fetch(`/api/v1/analytics/index/snapshots?workspaceId=${encodeURIComponent(workspaceId)}&days=30`),
      ]);

      if (!reportRes.ok) throw new Error(`Analytics request failed: ${reportRes.status}`);

      const reportJson = (await reportRes.json()) as { data: CompositionReport };
      setReport(reportJson.data);

      if (snapshotRes.ok) {
        const snapshotJson = (await snapshotRes.json()) as { data: Snapshot[] };
        setSnapshots(snapshotJson.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <nav className="mb-1 flex gap-2 text-xs text-gray-400">
            <Link href={`/analytics/${workspaceId}`} className="hover:text-gray-600">Analytics</Link>
            <span>/</span>
            <span className="text-gray-600">Index Composition</span>
          </nav>
          <h1 className="text-2xl font-bold text-gray-900">Index Composition</h1>
          {report && (
            <p className="mt-0.5 text-sm text-gray-500">
              {report.composition.totalEntities.toLocaleString()} entities indexed
              {' '}· snapshot at {new Date(report.composition.snapshotAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void fetchData()} />}

      {/* Main grid */}
      {loading && !report ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
          <LoadingCard />
        </div>
      ) : report ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Composition charts — full width */}
          <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-gray-800">Entity Distribution</h3>
            <CompositionCharts
              byEntityType={report.composition.byEntityType}
              byConnector={report.composition.byConnector}
            />
          </div>

          {/* Freshness timeline */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-gray-800">Freshness & Growth</h3>
            <FreshnessTimeline
              snapshots={snapshots}
              pctUpdatedLast7Days={report.freshness.pctUpdatedLast7Days}
              pctUpdatedLast30Days={report.freshness.pctUpdatedLast30Days}
              avgAgeByType={report.freshness.avgAgeByType}
            />
          </div>

          {/* Quality scorecard */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-gray-800">Quality & Optimization</h3>
            {report.quality ? (
              <QualityScorecard
                metrics={report.quality}
                opportunities={report.opportunities}
              />
            ) : (
              <div className="flex h-32 items-center justify-center text-sm text-gray-400">
                Quality metrics unavailable
              </div>
            )}
          </div>

          {/* Connector last-sync table */}
          <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-gray-800">Last Sync by Connector</h3>
            {Object.keys(report.freshness.lastSyncByConnector).length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="pb-2 font-medium">Connector</th>
                    <th className="pb-2 font-medium">Last Synced</th>
                    <th className="pb-2 font-medium">Age</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(report.freshness.lastSyncByConnector).map(([connectorId, lastSync]) => {
                    const ageMs = Date.now() - new Date(lastSync).getTime();
                    const ageHours = Math.floor(ageMs / 3_600_000);
                    const isStale = ageHours > 48;
                    return (
                      <tr key={connectorId} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 font-medium">{connectorId}</td>
                        <td className="py-2 text-gray-500">{new Date(lastSync).toLocaleString()}</td>
                        <td className={`py-2 font-medium ${isStale ? 'text-orange-500' : 'text-green-600'}`}>
                          {ageHours < 1 ? '< 1h' : `${ageHours}h`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="text-sm text-gray-400">No connector sync data available.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
