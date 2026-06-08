'use client';

type QueryEvent = {
  queryId: string;
  queryText: string;
  entityTypes: string[];
  cacheHit: boolean;
  latencyMs: number;
  timestamp: string;
};

type Props = {
  events: QueryEvent[];
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Renders a time × day-of-week heatmap showing query frequency.
 * Each cell colour intensity is proportional to the query count for that slot.
 */
export function QueryHeatmapChart({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-lg">
        No query data available for this period.
      </div>
    );
  }

  // Build a [day][hour] count matrix
  const matrix: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let maxCount = 1;

  for (const event of events) {
    const d = new Date(event.timestamp);
    const day = d.getDay();
    const hour = d.getHours();
    matrix[day]![hour]!++;
    if (matrix[day]![hour]! > maxCount) maxCount = matrix[day]![hour]!;
  }

  function cellColor(count: number): string {
    const intensity = count / maxCount;
    if (intensity === 0) return 'bg-gray-50';
    if (intensity < 0.25) return 'bg-indigo-100';
    if (intensity < 0.5) return 'bg-indigo-200';
    if (intensity < 0.75) return 'bg-indigo-400';
    return 'bg-indigo-600';
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900">Query Frequency Heatmap</h3>
      <p className="text-xs text-gray-500">Hour of day × day of week (darker = more queries)</p>

      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Hour labels */}
          <div className="flex ml-10">
            {HOURS.map((h) => (
              <div key={h} className="w-6 text-center text-xs text-gray-400 shrink-0">
                {h % 6 === 0 ? h : ''}
              </div>
            ))}
          </div>

          {/* Rows */}
          {DAYS.map((day, dayIdx) => (
            <div key={day} className="flex items-center gap-0.5 mt-0.5">
              <div className="w-8 text-xs text-gray-500 text-right pr-2">{day}</div>
              {HOURS.map((hour) => {
                const count = matrix[dayIdx]![hour]!;
                return (
                  <div
                    key={hour}
                    title={`${day} ${hour}:00 — ${count} queries`}
                    className={`w-6 h-5 rounded-sm shrink-0 cursor-default ${cellColor(count)}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
