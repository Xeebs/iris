'use client';

import { useEffect, useState } from 'react';
import { QualityDistributionChart } from '@/components/quality-distribution-chart';

type QualityIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
};

type QualityReport = {
  workspaceId: string;
  totalEntities: number;
  averageQualityScore: number;
  lowQualityCount: number;
  issues: { entityId: string; issues: QualityIssue[] }[];
  distributionBuckets: { bucket: string; count: number }[];
};

const SEVERITY_CLASS: Record<string, string> = {
  error: 'bg-red-100 text-red-700',
  warning: 'bg-yellow-100 text-yellow-700',
  info: 'bg-blue-100 text-blue-700',
};

export default function DataQualityPage({ params }: { params: { workspaceId: string } }) {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');

  useEffect(() => {
    const url = `/api/v1/data-quality/report${entityTypeFilter ? `?entityType=${entityTypeFilter}` : ''}`;
    setLoading(true);
    fetch(url)
      .then((res) => res.json())
      .then((body: { data?: QualityReport; error?: { message: string } }) => {
        if (body.data) setReport(body.data);
        else setError(body.error?.message ?? 'Unknown error');
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [entityTypeFilter, params.workspaceId]);

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6">Data Quality</h1>
        <p className="text-gray-500">Loading quality report…</p>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-6">Data Quality</h1>
        <div className="bg-red-50 border border-red-200 rounded p-4 text-red-700">
          Failed to load report: {error}
        </div>
      </div>
    );
  }

  const scorePercent = Math.round(report.averageQualityScore * 100);
  const scoreColor = scorePercent >= 80 ? 'text-green-600' : scorePercent >= 60 ? 'text-yellow-600' : 'text-red-600';

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Data Quality</h1>
        <div className="flex gap-2 items-center">
          <label className="text-sm text-gray-500">Filter by type:</label>
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm"
            placeholder="e.g. contact"
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
          />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500 mb-1">Average Quality Score</p>
          <p className={`text-3xl font-bold ${scoreColor}`}>{scorePercent}%</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500 mb-1">Total Entities</p>
          <p className="text-3xl font-bold text-gray-800">{report.totalEntities.toLocaleString()}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-sm text-gray-500 mb-1">Low Quality Entities</p>
          <p className="text-3xl font-bold text-red-600">{report.lowQualityCount.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">score &lt; 50%</p>
        </div>
      </div>

      {/* Distribution chart */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">Score Distribution</h2>
        <QualityDistributionChart buckets={report.distributionBuckets} />
      </div>

      {/* Issues list */}
      <div className="border rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">
          Quality Issues ({report.issues.length} affected entities)
        </h2>
        {report.issues.length === 0 ? (
          <p className="text-gray-500 text-sm">No issues found.</p>
        ) : (
          <div className="space-y-3">
            {report.issues.map(({ entityId, issues }) => (
              <div key={entityId} className="border rounded p-3">
                <p className="font-mono text-sm text-gray-700 mb-2">{entityId}</p>
                <div className="flex flex-wrap gap-2">
                  {issues.map((issue, i) => (
                    <span
                      key={i}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_CLASS[issue.severity] ?? 'bg-gray-100 text-gray-700'}`}
                      title={issue.message}
                    >
                      {issue.code}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
