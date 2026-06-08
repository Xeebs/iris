'use client';

type TimelinePoint = {
  date: string;
  tokens: number;
  queryCount: number;
  avgContextSize: number;
};

type BudgetUsageTimelineProps = {
  data: TimelinePoint[];
  monthlyBudget: number;
  title?: string;
};

export function BudgetUsageTimeline({ data, monthlyBudget, title = 'Daily Token Usage' }: BudgetUsageTimelineProps) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-400 text-center py-8">No usage data available.</p>
      </div>
    );
  }

  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);
  const budgetPerDay = Math.round(monthlyBudget / 30);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 bg-indigo-400 rounded-sm" /> Usage
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-orange-400" /> Daily budget
          </span>
        </div>
      </div>

      <div className="relative h-40 flex items-end gap-1">
        {/* Budget line */}
        {budgetPerDay <= maxTokens && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-orange-400 pointer-events-none"
            style={{ bottom: `${(budgetPerDay / maxTokens) * 100}%` }}
          />
        )}

        {data.map((point) => {
          const heightPct = Math.max(2, (point.tokens / maxTokens) * 100);
          const overBudget = point.tokens > budgetPerDay;
          return (
            <div key={point.date} className="flex-1 flex flex-col items-center gap-1 group relative">
              <div
                className={`w-full rounded-t transition-all ${overBudget ? 'bg-orange-400' : 'bg-indigo-400'} hover:opacity-80`}
                style={{ height: `${heightPct}%` }}
              />
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                <div>{new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                <div>{point.tokens.toLocaleString()} tokens</div>
                <div>{point.queryCount} queries</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex justify-between mt-1 text-xs text-gray-400">
        <span>{new Date(data[0]!.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>{new Date(data[data.length - 1]!.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>
    </div>
  );
}
