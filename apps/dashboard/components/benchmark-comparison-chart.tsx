'use client';

interface PercentileResult {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

interface PeerComparison {
  metric: string;
  workspaceValue: number;
  peerPercentiles: PercentileResult;
  percentileRank: number;
}

type Props = {
  comparisons: PeerComparison[];
};

const METRIC_LABELS: Record<string, string> = {
  tokenSavingsRatio: 'Token Savings',
  cacheHitRate: 'Cache Hit Rate',
  entityCount: 'Entity Count',
};

function formatValue(metric: string, value: number): string {
  if (metric === 'entityCount') return value.toLocaleString();
  return `${(value * 100).toFixed(1)}%`;
}

function rankLabel(rank: number): { label: string; color: string } {
  if (rank >= 90) return { label: 'Top 10%', color: 'text-green-600' };
  if (rank >= 75) return { label: 'Top 25%', color: 'text-emerald-600' };
  if (rank >= 50) return { label: 'Above median', color: 'text-blue-600' };
  if (rank >= 25) return { label: 'Below median', color: 'text-yellow-600' };
  return { label: 'Bottom 25%', color: 'text-red-500' };
}

/** Converts a value to a 0-100 position on the bar given the range [min, max]. */
function toPosition(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

function PercentileBar({
  comparison,
}: {
  comparison: PeerComparison;
}) {
  const { peerPercentiles: p, workspaceValue, metric, percentileRank } = comparison;
  const min = Math.min(p.p25 * 0.8, workspaceValue * 0.8);
  const max = Math.max(p.p90 * 1.1, workspaceValue * 1.1);
  const { label, color } = rankLabel(percentileRank);

  const p25Pos = toPosition(p.p25, min, max);
  const p75Pos = toPosition(p.p75, min, max);
  const p50Pos = toPosition(p.p50, min, max);
  const wsPos = toPosition(workspaceValue, min, max);

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-gray-700">{METRIC_LABELS[metric] ?? metric}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">
            {formatValue(metric, workspaceValue)}
          </span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 ${color}`}>
            {label}
          </span>
        </div>
      </div>

      {/* Box plot bar */}
      <div className="relative h-6 bg-gray-100 rounded">
        {/* IQR box (P25–P75) */}
        <div
          className="absolute top-1 h-4 bg-blue-200 rounded"
          style={{ left: `${p25Pos}%`, width: `${p75Pos - p25Pos}%` }}
        />
        {/* Median tick */}
        <div
          className="absolute top-0.5 h-5 w-0.5 bg-blue-600"
          style={{ left: `${p50Pos}%` }}
        />
        {/* Workspace marker */}
        <div
          className="absolute top-0 h-6 w-1 bg-orange-500 rounded"
          style={{ left: `${wsPos}%`, transform: 'translateX(-50%)' }}
          title={`Your value: ${formatValue(metric, workspaceValue)}`}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-400 mt-0.5">
        <span>P25: {formatValue(metric, p.p25)}</span>
        <span>Median: {formatValue(metric, p.p50)}</span>
        <span>P75: {formatValue(metric, p.p75)}</span>
      </div>
    </div>
  );
}

export function BenchmarkComparisonChart({ comparisons }: Props) {
  if (comparisons.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        No peer data available yet.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 bg-blue-200 rounded" /> IQR (P25–P75)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-0.5 h-3 bg-blue-600" /> Peer median
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1 h-3 bg-orange-500 rounded" /> Your workspace
        </span>
      </div>
      {comparisons.map((c) => (
        <PercentileBar key={c.metric} comparison={c} />
      ))}
    </div>
  );
}
