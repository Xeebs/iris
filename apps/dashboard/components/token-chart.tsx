import type { DailyTokenSummary } from '@/lib/api';

type TokenChartProps = {
  days: DailyTokenSummary[];
  maxTokens: number;
};

function Bar({ value, max, color }: { value: number; max: number; color: string }): React.JSX.Element {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 rounded" style={{ width: `${pct}%`, minWidth: 2, backgroundColor: color }} />
      <span className="text-xs text-gray-500 tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

/**
 * @param days - Daily token summary rows, most recent first
 * @param maxTokens - Denominator for normalising bar widths
 */
export function TokenChart({ days, maxTokens }: TokenChartProps): React.JSX.Element {
  if (days.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        No token data recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs font-medium text-gray-500">
            <th className="pb-2 pr-4">Date</th>
            <th className="pb-2 pr-4">Queries</th>
            <th className="pb-2 pr-4 w-48">Tokens Spent</th>
            <th className="pb-2 pr-4 w-48">Saved (Cache)</th>
            <th className="pb-2 pr-4 w-48">Saved (Compress)</th>
            <th className="pb-2">Cache Hit%</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date} className="border-b last:border-0">
              <td className="py-2 pr-4 font-mono text-xs">{day.date}</td>
              <td className="py-2 pr-4 tabular-nums">{day.queryCount}</td>
              <td className="py-2 pr-4">
                <Bar value={day.tokensSpent} max={maxTokens} color="#6366f1" />
              </td>
              <td className="py-2 pr-4">
                <Bar value={day.tokensSavedByCaching} max={maxTokens} color="#10b981" />
              </td>
              <td className="py-2 pr-4">
                <Bar value={day.tokensSavedByCompression} max={maxTokens} color="#f59e0b" />
              </td>
              <td className="py-2 tabular-nums">
                {(day.cacheHitRate * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
