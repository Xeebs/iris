'use client';

import type { IndexStatus } from '@iris/semantic-core';

interface Props {
  status: IndexStatus | null;
  loading?: boolean;
}

/** Displays entity count and bytes by type for a workspace's index. */
export function IndexCoverageCard({ status, loading = false }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg border p-4 animate-pulse">
        <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
        <div className="h-8 w-16 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-lg border p-4 text-gray-500 text-sm" data-testid="index-coverage-card">
        No index data available.
      </div>
    );
  }

  const totalMb = (status.totalBytes / 1_048_576).toFixed(2);

  return (
    <div className="rounded-lg border p-4 space-y-3" data-testid="index-coverage-card">
      <h3 className="font-semibold text-sm text-gray-700">Index Coverage</h3>

      <div className="flex gap-6">
        <Stat label="Total Entities" value={status.totalEntities.toLocaleString()} />
        <Stat label="Total Size" value={`${totalMb} MB`} />
        {status.lastIndexedAt && (
          <Stat label="Last Indexed" value={formatDate(status.lastIndexedAt)} />
        )}
      </div>

      {status.coverageByType.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">By Type</p>
          {status.coverageByType.map((c) => (
            <div key={c.entityType} className="flex justify-between text-sm">
              <span className="capitalize">{c.entityType}</span>
              <span className="text-gray-600">{c.entityCount.toLocaleString()} entities</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
