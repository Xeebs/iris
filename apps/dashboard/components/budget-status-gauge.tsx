'use client';

type BudgetStatusGaugeProps = {
  utilizationPct: number;
  monthlyBudget: number;
  tokensUsed: number;
  remainingTokens: number;
};

function gaugeColor(pct: number): string {
  if (pct >= 100) return '#ef4444';
  if (pct >= 90) return '#f97316';
  if (pct >= 75) return '#eab308';
  return '#22c55e';
}

export function BudgetStatusGauge({
  utilizationPct,
  monthlyBudget,
  tokensUsed,
  remainingTokens,
}: BudgetStatusGaugeProps) {
  const clamped = Math.min(utilizationPct, 100);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const color = gaugeColor(utilizationPct);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Context Budget</h3>

      <div className="flex items-center gap-6">
        {/* Circular gauge */}
        <div className="relative flex-shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="10" />
            <circle
              cx="64"
              cy="64"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 64 64)"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold" style={{ color }}>{clamped}%</span>
            <span className="text-xs text-gray-400">used</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-3">
          <div>
            <p className="text-xs text-gray-500">Used</p>
            <p className="text-sm font-semibold text-gray-900">{tokensUsed.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Remaining</p>
            <p className="text-sm font-semibold text-gray-900">{remainingTokens.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Monthly budget</p>
            <p className="text-sm font-semibold text-gray-900">{monthlyBudget.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {utilizationPct >= 75 && (
        <div
          className="mt-4 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {utilizationPct >= 100
            ? 'Budget exhausted — queries may be limited.'
            : utilizationPct >= 90
              ? 'Approaching budget limit. Consider increasing allocation.'
              : 'Over 75% of monthly budget consumed.'}
        </div>
      )}
    </div>
  );
}
