'use client';

type Props = {
  plan: string;
  entityCount: number;
  queryCount: number;
  entityLimit: number;
  queryLimit: number;
  onUpgrade: () => void;
};

function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const warn = pct >= 80;
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span>{used.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${warn ? 'bg-yellow-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function BillingCard({ plan, entityCount, queryCount, entityLimit, queryLimit, onUpgrade }: Props) {
  const isPro = plan.toLowerCase().includes('pro') || plan.toLowerCase().includes('enterprise');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500">Current Plan</p>
          <p className="text-lg font-bold text-gray-900">{plan}</p>
        </div>
        {!isPro && (
          <button
            onClick={onUpgrade}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
          >
            Upgrade to Pro
          </button>
        )}
      </div>

      <div className="space-y-3">
        <UsageBar used={entityCount} limit={entityLimit} label="Indexed Entities" />
        <UsageBar used={queryCount} limit={queryLimit} label="MCP Queries (this month)" />
      </div>

      {!isPro && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
          Upgrade to Pro for unlimited entities, priority sync, and SSO.
        </div>
      )}
    </div>
  );
}
