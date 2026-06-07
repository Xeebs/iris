'use client';

import { useState, useEffect } from 'react';

type Props = {
  workspaceId: string;
  plan: string;
};

interface BillingData {
  entityCount: number;
  queryCount: number;
  entityLimit: number;
  queryLimit: number;
}

const API_URL = typeof process !== 'undefined'
  ? (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1')
  : '/api/v1';

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
        <div className={`h-full rounded-full ${warn ? 'bg-yellow-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BillingCard({ workspaceId, plan }: Props) {
  const [billing, setBilling] = useState<BillingData | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/workspace/billing?workspaceId=${workspaceId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((b: { data: BillingData } | null) => b && setBilling(b.data))
      .catch(() => null);
  }, [workspaceId]);

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
            onClick={() => window.open('https://irisplatform.io/pricing', '_blank')}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
          >
            Upgrade to Pro
          </button>
        )}
      </div>

      {billing && (
        <div className="space-y-3">
          <UsageBar used={billing.entityCount} limit={billing.entityLimit} label="Indexed Entities" />
          <UsageBar used={billing.queryCount} limit={billing.queryLimit} label="MCP Queries (this month)" />
        </div>
      )}

      {!isPro && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-700">
          Upgrade to Pro for unlimited entities, priority sync, and SSO.
        </div>
      )}
    </div>
  );
}
