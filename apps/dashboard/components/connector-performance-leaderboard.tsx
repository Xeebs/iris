'use client';

interface ConnectorMetric {
  connectorId: string;
  name: string;
  throughputPerSec: number;
  avgLatencyMs: number;
  errorRate: number;
  totalRecords: number;
}

interface ConnectorPerformanceLeaderboardProps {
  metrics: ConnectorMetric[];
}

function ThroughputBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-700 rounded-full h-2">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono text-gray-300 w-16 text-right">
        {value.toFixed(1)}/s
      </span>
    </div>
  );
}

function ErrorRateBadge({ rate }: { rate: number }) {
  const pct = rate * 100;
  if (pct < 1) return <span className="text-xs text-green-400">OK ({pct.toFixed(1)}%)</span>;
  if (pct < 5) return <span className="text-xs text-yellow-400">{pct.toFixed(1)}%</span>;
  return <span className="text-xs text-red-400 font-semibold">{pct.toFixed(1)}%</span>;
}

/**
 * Leaderboard table showing fastest/slowest connectors by throughput.
 *
 * @param metrics - Per-connector performance metrics sorted by throughput
 */
export function ConnectorPerformanceLeaderboard({ metrics }: ConnectorPerformanceLeaderboardProps) {
  if (metrics.length === 0) {
    return <p className="text-sm text-gray-400 py-4">No performance data available yet.</p>;
  }

  const maxThroughput = Math.max(...metrics.map((m) => m.throughputPerSec));
  const sorted = [...metrics].sort((a, b) => b.throughputPerSec - a.throughputPerSec);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-700">
            <th className="pb-2 font-medium">#</th>
            <th className="pb-2 font-medium">Connector</th>
            <th className="pb-2 font-medium">Throughput</th>
            <th className="pb-2 font-medium text-right">Latency</th>
            <th className="pb-2 font-medium text-right">Errors</th>
            <th className="pb-2 font-medium text-right">Records</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {sorted.map((metric, idx) => (
            <tr key={metric.connectorId} className="hover:bg-gray-800/50 transition-colors">
              <td className="py-3 pr-2 text-gray-500">{idx + 1}</td>
              <td className="py-3 pr-4">
                <span className="text-white font-medium">{metric.name}</span>
                <span className="ml-2 text-xs text-gray-500 font-mono">{metric.connectorId}</span>
              </td>
              <td className="py-3 pr-4 min-w-32">
                <ThroughputBar value={metric.throughputPerSec} max={maxThroughput} />
              </td>
              <td className="py-3 pr-4 text-right font-mono text-gray-300">
                {metric.avgLatencyMs.toFixed(0)}ms
              </td>
              <td className="py-3 pr-4 text-right">
                <ErrorRateBadge rate={metric.errorRate} />
              </td>
              <td className="py-3 text-right font-mono text-gray-300">
                {metric.totalRecords.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
