'use client';

export type OptimizationSeverity = 'info' | 'warning' | 'critical';

export interface OptimizationSuggestion {
  id: string;
  title: string;
  description: string;
  severity: OptimizationSeverity;
  estimatedSavingsPercent: number;
}

export interface HotEntity {
  entityId: string;
  entityType: string;
  label: string;
  queryHits: number;
}

export interface IndexOptimizationReport {
  workspaceId: string;
  analyzedAt: string;
  totalEntities: number;
  hotEntities: HotEntity[];
  suggestions: OptimizationSuggestion[];
  cacheHitRatePct: number;
  compressionRatioPct: number;
}

interface IndexOptimizerPanelProps {
  report: IndexOptimizationReport | null;
  isLoading?: boolean;
}

const SEVERITY_STYLES: Record<OptimizationSeverity, { badge: string; icon: string }> = {
  critical: { badge: 'bg-red-100 text-red-700', icon: '⚠' },
  warning: { badge: 'bg-yellow-100 text-yellow-700', icon: '!' },
  info: { badge: 'bg-blue-100 text-blue-700', icon: 'i' },
};

/**
 * Admin panel showing index size, hot entities, and optimization suggestions.
 *
 * @param report    - Optimization report from GET /api/v1/index/optimize
 * @param isLoading - Shows skeleton state while fetching
 */
export function IndexOptimizerPanel({ report, isLoading }: IndexOptimizerPanelProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="h-5 w-48 rounded bg-gray-200" />
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded bg-gray-100" />)}
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm text-sm text-gray-500">
        No optimization data available. Run an analysis to get started.
      </div>
    );
  }

  const maxHits = report.hotEntities[0]?.queryHits ?? 1;

  return (
    <div className="space-y-4">
      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Entities', value: report.totalEntities.toLocaleString() },
          { label: 'Cache Hit Rate', value: `${report.cacheHitRatePct}%` },
          { label: 'Token Compression', value: `${report.compressionRatioPct}%` },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Suggestions */}
      {report.suggestions.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Optimization Suggestions</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {report.suggestions.map(s => {
              const style = SEVERITY_STYLES[s.severity];
              return (
                <div key={s.id} className="flex items-start gap-3 px-5 py-3">
                  <span className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.badge}`}>
                    {style.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{s.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
                  </div>
                  {s.estimatedSavingsPercent > 0 && (
                    <span className="flex-shrink-0 text-xs font-medium text-green-600">
                      ~{s.estimatedSavingsPercent}% savings
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hot entities */}
      {report.hotEntities.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Hot Entity Types</h3>
          </div>
          <div className="px-5 py-3 space-y-2">
            {report.hotEntities.map(entity => (
              <div key={entity.entityId} className="flex items-center gap-3">
                <span className="w-24 flex-shrink-0 text-xs font-medium text-gray-700 capitalize">
                  {entity.entityType}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{ width: `${Math.round((entity.queryHits / maxHits) * 100)}%` }}
                  />
                </div>
                <span className="w-12 flex-shrink-0 text-right text-xs text-gray-500">
                  {entity.queryHits.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-right text-xs text-gray-400">
        Analyzed at {new Date(report.analyzedAt).toLocaleString()}
      </p>
    </div>
  );
}
