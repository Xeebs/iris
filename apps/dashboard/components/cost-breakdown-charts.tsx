'use client';

import { useMemo } from 'react';

type CostCategory = 'embeddings' | 'queries' | 'storage' | 'cache_miss';

interface DailyEntry {
  date: string;
  amountCents: number;
}

interface CategoryBreakdown {
  [category: string]: number;
}

interface CostBreakdownChartsProps {
  dailyTrend: DailyEntry[];
  byCategory: Record<CostCategory, number>;
  totalCents: number;
}

const CATEGORY_COLORS: Record<CostCategory, string> = {
  embeddings: '#6366f1',
  queries: '#10b981',
  storage: '#f59e0b',
  cache_miss: '#ef4444',
};

const CATEGORY_LABELS: Record<CostCategory, string> = {
  embeddings: 'Embeddings',
  queries: 'Queries',
  storage: 'Storage',
  cache_miss: 'Cache Misses',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`;
}

/**
 * Daily cost trend bar chart — renders relative-height bars for each day.
 */
function DailyTrendChart({ data }: { data: DailyEntry[] }) {
  const maxCents = useMemo(() => Math.max(...data.map((d) => d.amountCents), 0.001), [data]);

  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-4">No cost data for this period.</p>;
  }

  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((entry) => {
        const heightPct = (entry.amountCents / maxCents) * 100;
        return (
          <div key={entry.date} className="flex flex-col items-center flex-1 min-w-0 group">
            <div
              className="w-full bg-indigo-500 rounded-t transition-all duration-200 group-hover:bg-indigo-400 relative"
              style={{ height: `${heightPct}%` }}
              title={`${entry.date}: ${formatCents(entry.amountCents)}`}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-gray-300 hidden group-hover:block whitespace-nowrap">
                {formatCents(entry.amountCents)}
              </span>
            </div>
            {data.length <= 14 && (
              <span className="text-[9px] text-gray-400 mt-1 truncate w-full text-center">
                {entry.date.slice(5)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Category donut-style breakdown using flex bars.
 */
function CategoryBreakdownBar({
  byCategory,
  totalCents,
}: {
  byCategory: Record<CostCategory, number>;
  totalCents: number;
}) {
  const categories = Object.entries(byCategory) as [CostCategory, number][];
  const nonZero = categories.filter(([, v]) => v > 0);

  if (nonZero.length === 0 || totalCents === 0) {
    return <p className="text-sm text-gray-400">No costs recorded.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex h-4 rounded-full overflow-hidden">
        {nonZero.map(([cat, cents]) => (
          <div
            key={cat}
            style={{
              width: `${(cents / totalCents) * 100}%`,
              backgroundColor: CATEGORY_COLORS[cat],
            }}
            title={`${CATEGORY_LABELS[cat]}: ${formatCents(cents)}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
        {categories.map(([cat, cents]) => (
          <li key={cat} className="flex items-center gap-2 text-sm text-gray-300">
            <span
              className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: CATEGORY_COLORS[cat] }}
            />
            <span className="truncate">{CATEGORY_LABELS[cat]}</span>
            <span className="ml-auto font-mono text-xs text-gray-400">{formatCents(cents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Top-level cost breakdown charts component for the workspace cost page.
 *
 * @param dailyTrend - Per-day cost totals
 * @param byCategory - Costs aggregated by category
 * @param totalCents - Grand total for the period
 */
export function CostBreakdownCharts({
  dailyTrend,
  byCategory,
  totalCents,
}: CostBreakdownChartsProps) {
  return (
    <div className="space-y-8">
      <div className="bg-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider">
            Daily Cost Trend
          </h3>
          <span className="text-lg font-mono font-semibold text-white">
            {formatCents(totalCents)} total
          </span>
        </div>
        <DailyTrendChart data={dailyTrend} />
      </div>

      <div className="bg-gray-800 rounded-xl p-6">
        <h3 className="text-sm font-medium text-gray-300 uppercase tracking-wider mb-4">
          Cost by Category
        </h3>
        <CategoryBreakdownBar byCategory={byCategory} totalCents={totalCents} />
      </div>
    </div>
  );
}
