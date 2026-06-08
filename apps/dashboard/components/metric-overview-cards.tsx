'use client';

type MetricCard = {
  label: string;
  value: string | number;
  sublabel?: string;
  trend?: 'up' | 'down' | 'stable';
};

type Props = {
  cards: MetricCard[];
  loading?: boolean;
};

const TREND_ICONS: Record<string, string> = {
  up: '↑',
  down: '↓',
  stable: '→',
};

const TREND_COLORS: Record<string, string> = {
  up: 'text-green-400',
  down: 'text-red-400',
  stable: 'text-zinc-400',
};

export function MetricOverviewCards({ cards, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-700 bg-zinc-800 p-5 animate-pulse h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card, i) => (
        <div key={i} className="rounded-lg border border-zinc-700 bg-zinc-800 p-5">
          <p className="text-xs text-zinc-400 uppercase tracking-wider">{card.label}</p>
          <p className="text-2xl font-bold text-white mt-1">{card.value}</p>
          {(card.sublabel ?? card.trend) && (
            <div className="flex items-center gap-1 mt-1">
              {card.trend && (
                <span className={`text-xs font-medium ${TREND_COLORS[card.trend] ?? ''}`}>
                  {TREND_ICONS[card.trend]}
                </span>
              )}
              {card.sublabel && <span className="text-xs text-zinc-500">{card.sublabel}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
