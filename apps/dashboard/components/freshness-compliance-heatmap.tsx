'use client';

import { useEffect, useState } from 'react';

type HeatmapCell = {
  connectorId: string;
  entityType: string;
  slaComplianceRate: number;
  meanAgeSec: number;
};

type Props = {
  workspaceId?: string;
  connectorIds?: string[];
};

/**
 * Renders a compliance heatmap matrix: entity type × connector with SLA compliance colour.
 */
export function FreshnessComplianceHeatmap({ connectorIds = [] }: Props) {
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectorIds.length === 0) {
      setLoading(false);
      return;
    }

    Promise.all(
      connectorIds.map((cid) =>
        fetch(`/api/v1/freshness/metrics/${cid}?intervalDays=7`)
          .then((r) => r.json())
          .then((body) => {
            const breakdown: { entityType: string; meanAgeSec: number }[] =
              body.data?.entityTypeBreakdown ?? [];
            const rate: number = body.data?.slaComplianceRate ?? 100;
            return breakdown.map((b) => ({
              connectorId: cid,
              entityType: b.entityType,
              slaComplianceRate: rate,
              meanAgeSec: b.meanAgeSec,
            }));
          }),
      ),
    )
      .then((results) => setCells(results.flat()))
      .catch(() => setError('Failed to load compliance data'))
      .finally(() => setLoading(false));
  }, [connectorIds.join(',')]);

  const connectors = [...new Set(cells.map((c) => c.connectorId))];
  const entityTypes = [...new Set(cells.map((c) => c.entityType))];

  function getCell(connectorId: string, entityType: string): HeatmapCell | undefined {
    return cells.find((c) => c.connectorId === connectorId && c.entityType === entityType);
  }

  function complianceColor(rate: number): string {
    if (rate >= 95) return 'bg-green-100 text-green-800';
    if (rate >= 80) return 'bg-amber-100 text-amber-800';
    if (rate >= 60) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  }

  function formatAge(sec: number): string {
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
    return `${(sec / 86400).toFixed(1)}d`;
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse">
          <div className="mb-3 h-4 w-48 rounded bg-gray-200" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-gray-100" />
            ))}
          </div>
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

  if (cells.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Freshness Compliance</h3>
        <p className="text-sm text-gray-400">
          {connectorIds.length === 0
            ? 'No connectors selected.'
            : 'No freshness data available.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Freshness Compliance Heatmap</h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-green-200" /> ≥95%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-amber-200" /> ≥80%
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-red-200" /> &lt;60%
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 pr-3 text-left text-gray-500 font-normal">Entity Type</th>
              {connectors.map((cid) => (
                <th key={cid} className="px-2 py-1 text-center font-medium text-gray-700 capitalize">
                  {cid}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entityTypes.map((type) => (
              <tr key={type} className="border-t border-gray-50">
                <td className="py-1.5 pr-3 capitalize text-gray-600">{type}</td>
                {connectors.map((cid) => {
                  const cell = getCell(cid, type);
                  return (
                    <td key={cid} className="px-2 py-1.5 text-center">
                      {cell ? (
                        <div
                          className={`inline-flex flex-col items-center rounded px-2 py-1 ${complianceColor(cell.slaComplianceRate)}`}
                          title={`Avg age: ${formatAge(cell.meanAgeSec)}`}
                        >
                          <span className="font-semibold">{cell.slaComplianceRate.toFixed(0)}%</span>
                          <span className="text-gray-500 text-[10px]">{formatAge(cell.meanAgeSec)}</span>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
