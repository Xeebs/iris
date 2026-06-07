'use client';

type Bucket = {
  bucket: string;
  count: number;
};

type Props = {
  buckets: Bucket[];
};

/**
 * Simple bar chart for entity quality score distribution.
 * Pure CSS — no chart library dependency.
 */
export function QualityDistributionChart({ buckets }: Props) {
  const max = Math.max(...buckets.map((b) => b.count), 1);

  const barColor = (label: string) => {
    if (label.startsWith('0.0') || label.startsWith('0.2')) return 'bg-red-400';
    if (label.startsWith('0.4')) return 'bg-yellow-400';
    return 'bg-green-400';
  };

  return (
    <div className="flex items-end gap-3 h-40">
      {buckets.map(({ bucket, count }) => (
        <div key={bucket} className="flex flex-col items-center flex-1 gap-1">
          <span className="text-xs text-gray-500">{count}</span>
          <div
            className={`w-full rounded-t ${barColor(bucket)}`}
            style={{ height: `${Math.round((count / max) * 120)}px` }}
          />
          <span className="text-xs text-gray-400 whitespace-nowrap">{bucket}</span>
        </div>
      ))}
    </div>
  );
}
