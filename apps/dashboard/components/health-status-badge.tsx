'use client';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

type Props = {
  status: HealthStatus;
  size?: 'sm' | 'md';
};

const STATUS_CONFIG: Record<HealthStatus, { label: string; classes: string; dot: string }> = {
  healthy:   { label: 'Healthy',   classes: 'bg-green-100 text-green-700 border-green-200',   dot: 'bg-green-500' },
  degraded:  { label: 'Degraded',  classes: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500' },
  unhealthy: { label: 'Unhealthy', classes: 'bg-red-100 text-red-700 border-red-200',         dot: 'bg-red-500' },
  unknown:   { label: 'Unknown',   classes: 'bg-gray-100 text-gray-600 border-gray-200',      dot: 'bg-gray-400' },
};

export function HealthStatusBadge({ status, size = 'md' }: Props) {
  const cfg = STATUS_CONFIG[status];
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const padSize = size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1';
  const dotSize = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-medium ${textSize} ${padSize} ${cfg.classes}`}>
      <span className={`rounded-full ${dotSize} ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
