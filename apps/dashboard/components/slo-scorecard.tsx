'use client';

type SloStatus = 'ok' | 'warning' | 'breached';

type SloAttainment = {
  sloName: string;
  metric: string;
  target: number;
  attainmentPct: number;
  totalEvents: number;
  metEvents: number;
  windowHours: number;
  status: SloStatus;
};

type Props = {
  slo: SloAttainment;
};

const STATUS_CONFIG: Record<SloStatus, { ring: string; badge: string; label: string; icon: string }> = {
  ok: { ring: 'ring-green-200', badge: 'bg-green-100 text-green-700', label: 'Meeting SLO', icon: '✓' },
  warning: { ring: 'ring-yellow-200', badge: 'bg-yellow-100 text-yellow-700', label: 'At risk', icon: '⚠' },
  breached: { ring: 'ring-red-200', badge: 'bg-red-100 text-red-700', label: 'Breached', icon: '✗' },
};

export function SloScorecard({ slo }: Props) {
  const cfg = STATUS_CONFIG[slo.status];
  const attainmentDisplay = `${(slo.attainmentPct * 100).toFixed(2)}%`;
  const targetDisplay = `${(slo.target * 100).toFixed(2)}%`;
  const progressWidth = Math.min(100, slo.attainmentPct * 100);
  const targetLineLeft = slo.target * 100;

  return (
    <div className={`border rounded-xl p-4 space-y-3 ring-1 ${cfg.ring}`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-sm text-gray-800">{slo.sloName}</div>
          <div className="text-xs text-gray-400 font-mono mt-0.5">{slo.metric}</div>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>
          {cfg.icon} {cfg.label}
        </span>
      </div>

      {/* Attainment bar */}
      <div className="relative">
        <div className="h-2 bg-gray-100 rounded-full overflow-visible relative">
          <div
            className={`h-full rounded-full transition-all ${
              slo.status === 'ok' ? 'bg-green-500' : slo.status === 'warning' ? 'bg-yellow-400' : 'bg-red-500'
            }`}
            style={{ width: `${progressWidth}%` }}
          />
          {/* Target marker */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-500 rounded"
            style={{ left: `${targetLineLeft}%` }}
            title={`Target: ${targetDisplay}`}
          />
        </div>
      </div>

      <div className="flex justify-between text-xs">
        <div>
          <span className="text-gray-400">Attainment </span>
          <span className={`font-semibold ${slo.status === 'ok' ? 'text-green-700' : slo.status === 'warning' ? 'text-yellow-700' : 'text-red-700'}`}>
            {attainmentDisplay}
          </span>
        </div>
        <div>
          <span className="text-gray-400">Target </span>
          <span className="font-medium text-gray-700">{targetDisplay}</span>
        </div>
        <div className="text-gray-400">{slo.totalEvents} events / {slo.windowHours}h</div>
      </div>
    </div>
  );
}
