'use client';

type IntentStats = { count: number; avgCompression: number };
type SummarizationStatsData = {
  totalSummaries: number;
  avgCompressionRatio: number;
  avgSatisfactionScore: number;
  byIntent: Record<string, IntentStats>;
};

const INTENT_COLORS: Record<string, string> = {
  analytical: '#4f46e5',
  operational: '#10b981',
  reporting: '#f59e0b',
  synthesis: '#8b5cf6',
};

export default function SummarizationStats({ data }: { data: SummarizationStatsData }) {
  const intents = Object.entries(data.byIntent) as [string, IntentStats][];
  const maxCount = Math.max(...intents.map(([, s]) => s.count), 1);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-2xl font-semibold text-gray-900">{data.totalSummaries.toLocaleString()}</p>
          <p className="text-xs text-gray-500">Total summaries</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold text-green-600">{(data.avgCompressionRatio * 100).toFixed(0)}%</p>
          <p className="text-xs text-gray-500">Avg compression</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-semibold text-blue-600">{(data.avgSatisfactionScore * 5).toFixed(1)}/5</p>
          <p className="text-xs text-gray-500">Avg satisfaction</p>
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">By Intent</h4>
        <div className="space-y-3">
          {intents.map(([intent, stats]) => (
            <div key={intent}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-gray-700 capitalize">{intent}</span>
                <span className="text-gray-500">{stats.count} summaries · {(stats.avgCompression * 100).toFixed(0)}% compression</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${(stats.count / maxCount) * 100}%`,
                    backgroundColor: INTENT_COLORS[intent] ?? '#94a3b8',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
