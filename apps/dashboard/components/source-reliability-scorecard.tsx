'use client';

import { useEffect, useState } from 'react';

type SourceRecord = {
  sourceId: string;
  entityType: string;
  accuracyRating: number | null;
  confidenceAvg: number;
  feedbackCount: number;
};

type Props = {
  connectorIds: string[];
};

function accuracyColor(rating: number): string {
  if (rating >= 0.9) return 'text-green-700';
  if (rating >= 0.7) return 'text-amber-700';
  return 'text-red-700';
}

/**
 * Scorecard showing per-source reliability (accuracy + confidence) across connector IDs.
 */
export function SourceReliabilityScorecard({ connectorIds }: Props) {
  const [records, setRecords] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(
      connectorIds.map((id) =>
        fetch(`/api/v1/enrichment/sources/${id}/reliability`)
          .then((r) => r.json())
          .then((body) => (body.data as SourceRecord[]).map((rec) => ({ ...rec, sourceId: id }))),
      ),
    )
      .then((results) => setRecords(results.flat()))
      .catch(() => setError('Failed to load source reliability'))
      .finally(() => setLoading(false));
  }, [connectorIds.join(',')]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 p-4">
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Source Reliability Scorecard</h3>

      {records.length === 0 ? (
        <p className="text-sm text-gray-400">No source reliability data available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="py-1 pr-3 text-left text-gray-500 font-normal">Source</th>
                <th className="px-3 py-1 text-left text-gray-500 font-normal">Entity Type</th>
                <th className="px-3 py-1 text-right text-gray-500 font-normal">Accuracy</th>
                <th className="px-3 py-1 text-right text-gray-500 font-normal">Confidence</th>
                <th className="px-3 py-1 text-right text-gray-500 font-normal">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="py-2 pr-3 font-medium text-gray-700">{r.sourceId}</td>
                  <td className="px-3 py-2 capitalize text-gray-600">{r.entityType}</td>
                  <td className="px-3 py-2 text-right">
                    {r.accuracyRating !== null ? (
                      <span className={`font-semibold ${accuracyColor(r.accuracyRating)}`}>
                        {(r.accuracyRating * 100).toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-700">
                    {(r.confidenceAvg * 100).toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right text-gray-500">{r.feedbackCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
