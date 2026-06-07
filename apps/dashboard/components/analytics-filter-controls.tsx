'use client';

export type Granularity = 'hourly' | 'daily' | 'weekly' | 'monthly';
export type GroupBy = 'connector' | 'tool';

type Props = {
  granularity: Granularity;
  groupBy: GroupBy;
  days: number;
  onGranularityChange: (v: Granularity) => void;
  onGroupByChange: (v: GroupBy) => void;
  onDaysChange: (v: number) => void;
};

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const DAY_OPTIONS = [7, 14, 30, 90] as const;

export function AnalyticsFilterControls({
  granularity,
  groupBy,
  days,
  onGranularityChange,
  onGroupByChange,
  onDaysChange,
}: Props) {
  return (
    <div className="flex flex-wrap gap-4 items-center">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Time range</span>
        <div className="flex border rounded overflow-hidden">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => onDaysChange(d)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === d
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Granularity</span>
        <select
          value={granularity}
          onChange={(e) => onGranularityChange(e.target.value as Granularity)}
          className="border rounded px-2 py-1.5 text-xs text-gray-700"
        >
          {GRANULARITIES.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500">Group by</span>
        <div className="flex border rounded overflow-hidden">
          <button
            onClick={() => onGroupByChange('connector')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              groupBy === 'connector' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Connector
          </button>
          <button
            onClick={() => onGroupByChange('tool')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              groupBy === 'tool' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Tool
          </button>
        </div>
      </div>
    </div>
  );
}
