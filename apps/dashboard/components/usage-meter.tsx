'use client';

type TierLimits = {
  requestsPerMinute: number;
  requestsPerDay: number;
  mcpCallsPerHour: number;
};

type QuotaStatus = {
  workspaceId: string;
  tier: string;
  requestsThisMinute: number;
  requestsToday: number;
  mcpCallsThisHour: number;
  limits: TierLimits;
  rateLimited: boolean;
  retryAfterMs: number | null;
};

type Props = { status: QuotaStatus | null; loading?: boolean };

function MeterBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const color = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="text-zinc-300 font-mono">{value.toLocaleString()} / {max.toLocaleString()}</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-700 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-right text-xs text-zinc-600">{pct.toFixed(1)}% used</p>
    </div>
  );
}

export function UsageMeter({ status, loading }: Props) {
  if (loading) {
    return <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-sm text-zinc-500">Loading usage…</div>;
  }
  if (!status) {
    return <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 text-sm text-zinc-500">No usage data available.</div>;
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-300">API Usage</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full ${status.rateLimited ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
          {status.rateLimited ? 'Rate Limited' : 'OK'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">Tier</span>
        <span className="text-xs font-medium text-white capitalize bg-zinc-700 px-2 py-0.5 rounded">{status.tier}</span>
      </div>

      <div className="space-y-4">
        <MeterBar
          label="Requests this minute"
          value={status.requestsThisMinute}
          max={status.limits.requestsPerMinute}
        />
        <MeterBar
          label="Requests today"
          value={status.requestsToday}
          max={status.limits.requestsPerDay}
        />
        <MeterBar
          label="MCP calls this hour"
          value={status.mcpCallsThisHour}
          max={status.limits.mcpCallsPerHour}
        />
      </div>

      {status.rateLimited && status.retryAfterMs !== null && (
        <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded">
          Rate limited. Retry in {Math.ceil(status.retryAfterMs / 1000)}s.
        </p>
      )}
    </div>
  );
}
