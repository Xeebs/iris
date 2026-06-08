'use client';

import type { OptimizationOpportunity } from '@iris/semantic-core/index-analytics';

interface QualityMetrics {
  pctWithRelationships: number;
  avgRelationshipDensity: number;
  embeddingCoveragePct: number;
  dedupRatioLast30Days: number;
}

interface QualityScorecardProps {
  metrics: QualityMetrics;
  opportunities: OptimizationOpportunity[];
  onApplyOpportunity?: (id: string) => void;
}

function ScoreItem({
  label,
  value,
  unit = '%',
  good = true,
  tooltip,
}: {
  label: string;
  value: number;
  unit?: string;
  good?: boolean;
  tooltip?: string;
}) {
  const color = good ? 'text-green-600' : 'text-orange-500';
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-3" title={tooltip}>
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xl font-bold ${color}`}>
        {value.toFixed(1)}<span className="text-sm font-normal text-gray-400">{unit}</span>
      </span>
    </div>
  );
}

const OPPORTUNITY_TYPE_ICONS: Record<OptimizationOpportunity['type'], string> = {
  dedup: '🔗',
  archive_connector: '📦',
  prune_stale: '🗑️',
  index_rebalance: '⚡',
};

const PRIORITY_COLORS: Record<OptimizationOpportunity['priority'], string> = {
  high: 'bg-red-50 border-red-200 text-red-800',
  medium: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  low: 'bg-gray-50 border-gray-200 text-gray-700',
};

/**
 * Renders a quality scorecard with entity relationship coverage, embedding coverage,
 * and dedup ratios, followed by ranked optimization recommendations.
 */
export function QualityScorecard({ metrics, opportunities, onApplyOpportunity }: QualityScorecardProps) {
  return (
    <div className="space-y-6">
      {/* Metrics grid */}
      <div>
        <h4 className="mb-3 text-sm font-medium text-gray-700">Quality Metrics</h4>
        <div className="grid grid-cols-2 gap-3">
          <ScoreItem
            label="Entities with Relationships"
            value={metrics.pctWithRelationships}
            good={metrics.pctWithRelationships > 30}
            tooltip="% of indexed entities that have at least one relationship"
          />
          <ScoreItem
            label="Avg Relationship Density"
            value={metrics.avgRelationshipDensity}
            unit=" edges"
            good={metrics.avgRelationshipDensity > 1}
            tooltip="Average number of relationships per connected entity"
          />
          <ScoreItem
            label="Embedding Coverage"
            value={metrics.embeddingCoveragePct}
            good={metrics.embeddingCoveragePct > 90}
            tooltip="% of entities with a valid embedding vector (required for semantic search)"
          />
          <ScoreItem
            label="Dedup Rate (30d)"
            value={metrics.dedupRatioLast30Days}
            good={metrics.dedupRatioLast30Days < 5}
            tooltip="% of entities removed as duplicates in the last 30 days"
          />
        </div>
      </div>

      {/* Optimization recommendations */}
      {opportunities.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-gray-700">
            Optimization Opportunities
            <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {opportunities.length}
            </span>
          </h4>
          <div className="space-y-2">
            {opportunities.map((opp) => (
              <div
                key={opp.id}
                className={`rounded-lg border p-3 ${PRIORITY_COLORS[opp.priority]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">
                      <span className="mr-1.5">{OPPORTUNITY_TYPE_ICONS[opp.type]}</span>
                      {opp.title}
                    </p>
                    <p className="mt-0.5 text-xs opacity-80">{opp.description}</p>
                    {opp.estimatedMonthlySavingsCents > 0 && (
                      <p className="mt-1 text-xs font-medium">
                        Est. savings: ${(opp.estimatedMonthlySavingsCents / 100).toFixed(2)}/mo
                      </p>
                    )}
                  </div>
                  {onApplyOpportunity && (
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-current px-2 py-1 text-xs font-medium opacity-70 hover:opacity-100"
                      onClick={() => onApplyOpportunity(opp.id)}
                    >
                      Apply
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {opportunities.length === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          No optimization opportunities found. Index looks healthy!
        </div>
      )}
    </div>
  );
}
