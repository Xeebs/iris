'use client';

import React from 'react';

export type HeatmapCell = {
  queryHash: string;
  queryText: string | null;
  entityType: string | null;
  hitRate: number;
  totalRequests: number;
  cacheHits: number;
  totalSavedTokens: number;
};

type Props = {
  cells: HeatmapCell[];
  maxRows?: number;
};

function hitRateColor(rate: number): string {
  if (rate >= 0.9) return 'bg-green-600 text-white';
  if (rate >= 0.7) return 'bg-green-400 text-white';
  if (rate >= 0.5) return 'bg-yellow-400 text-gray-900';
  if (rate >= 0.3) return 'bg-orange-400 text-white';
  return 'bg-red-500 text-white';
}

export function CacheEfficiencyHeatmap({ cells, maxRows = 20 }: Props) {
  const visible = cells.slice(0, maxRows);
  const entityTypes = Array.from(new Set(cells.map((c) => c.entityType ?? 'unknown')));
  const byType = (type: string) => visible.filter((c) => (c.entityType ?? 'unknown') === type);

  if (cells.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No cache statistics available yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Cache Efficiency by Query &amp; Entity Type</h3>
        <div className="flex gap-2 text-xs items-center">
          {[
            { label: '≥90%', color: 'bg-green-600' },
            { label: '70-90%', color: 'bg-green-400' },
            { label: '50-70%', color: 'bg-yellow-400' },
            { label: '30-50%', color: 'bg-orange-400' },
            { label: '<30%', color: 'bg-red-500' },
          ].map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1">
              <span className={`w-3 h-3 rounded-sm inline-block ${color}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {entityTypes.map((type) => {
        const typeCells = byType(type);
        if (typeCells.length === 0) return null;
        return (
          <div key={type}>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{type}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {typeCells.map((cell) => (
                <div
                  key={cell.queryHash}
                  title={`${cell.queryText ?? cell.queryHash}\nHit rate: ${(cell.hitRate * 100).toFixed(1)}%\nHits: ${cell.cacheHits}/${cell.totalRequests}\nSaved tokens: ${cell.totalSavedTokens.toLocaleString()}`}
                  className={`rounded-md p-3 cursor-default transition-transform hover:scale-105 ${hitRateColor(cell.hitRate)}`}
                >
                  <p className="text-xs font-medium truncate">
                    {cell.queryText ?? cell.queryHash.slice(0, 12) + '…'}
                  </p>
                  <p className="text-lg font-bold leading-tight mt-1">
                    {(cell.hitRate * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs opacity-80">
                    {cell.cacheHits}/{cell.totalRequests} hits
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-gray-400 text-right">
        Showing {visible.length} of {cells.length} queries
      </p>
    </div>
  );
}
