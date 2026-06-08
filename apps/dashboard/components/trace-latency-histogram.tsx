'use client';

type LatencyPercentiles = { p50: number; p95: number; p99: number };

function Bar({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 text-xs text-zinc-500 text-right">{label}</div>
      <div className="flex-1 bg-zinc-700 rounded h-3 overflow-hidden">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-16 text-xs text-zinc-300 text-right">{value.toFixed(1)}ms</div>
    </div>
  );
}

export function TraceLatencyHistogram({
  operationName,
  percentiles,
}: {
  operationName: string;
  percentiles: LatencyPercentiles;
}) {
  const max = Math.max(percentiles.p99, 1);
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      <div className="text-xs text-zinc-400 mb-3 font-medium">{operationName}</div>
      <div className="space-y-2">
        <Bar value={percentiles.p50} max={max} label="p50" color="bg-green-500" />
        <Bar value={percentiles.p95} max={max} label="p95" color="bg-yellow-500" />
        <Bar value={percentiles.p99} max={max} label="p99" color="bg-red-500" />
      </div>
    </div>
  );
}
