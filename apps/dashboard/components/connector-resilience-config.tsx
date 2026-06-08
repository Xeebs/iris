'use client';

import { useState, useEffect, useCallback } from 'react';

type BackoffStrategy = 'exponential' | 'linear' | 'fibonacci';

type ResiliencePolicy = {
  connectorId: string;
  maxRetries: number;
  backoffStrategy: BackoffStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  circuitBreakerThreshold: number;
  circuitCooldownMs: number;
  timeoutMs: number;
  maxConcurrent: number;
};

type ResilienceMetrics = {
  connectorId: string;
  retryCount: number;
  timeoutCount: number;
  circuitBreakerTrips: number;
  successCount: number;
  failureCount: number;
  lastFailureAt: string | null;
  circuitState: 'closed' | 'open' | 'half_open';
};

type ConnectorResilienceConfigProps = {
  connectorId: string;
};

const STATE_COLORS: Record<string, string> = {
  closed: 'bg-green-100 text-green-700',
  open: 'bg-red-100 text-red-700',
  half_open: 'bg-amber-100 text-amber-700',
};

function MetricRow({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="flex justify-between py-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium tabular-nums text-gray-900">{value}</span>
    </div>
  );
}

export function ConnectorResilienceConfig({ connectorId }: ConnectorResilienceConfigProps): React.JSX.Element {
  const [metrics, setMetrics] = useState<ResilienceMetrics | null>(null);
  const [policy, setPolicy] = useState<ResiliencePolicy | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<ResiliencePolicy>>({});
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/connectors/resilience/${connectorId}`);
      if (res.ok) {
        const body = await res.json() as { data: { metrics: ResilienceMetrics; policy: ResiliencePolicy } };
        setMetrics(body.data.metrics);
        setPolicy(body.data.policy);
        setDraft(body.data.policy);
      }
    } catch {
      // non-fatal
    }
  }, [connectorId]);

  useEffect(() => { void load(); }, [load]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/connectors/resilience/${connectorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (res.ok) {
        setNotification('Policy saved');
        setEditing(false);
        await load();
      } else {
        setNotification('Failed to save policy');
      }
    } finally {
      setSaving(false);
      setTimeout(() => setNotification(null), 3000);
    }
  }

  async function handleReset(): Promise<void> {
    await fetch(`/api/v1/admin/connectors/resilience/${connectorId}/reset`, { method: 'DELETE' });
    setNotification('Circuit reset');
    await load();
    setTimeout(() => setNotification(null), 3000);
  }

  if (!metrics || !policy) {
    return <div className="h-32 animate-pulse rounded-xl bg-gray-100" />;
  }

  const successRate = metrics.successCount + metrics.failureCount > 0
    ? Math.round((metrics.successCount / (metrics.successCount + metrics.failureCount)) * 100)
    : 100;

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-900">{connectorId}</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATE_COLORS[metrics.circuitState] ?? 'bg-gray-100 text-gray-600'}`}>
            {metrics.circuitState.replace('_', '-')}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleReset()}
            className="rounded-lg border px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50"
          >
            Reset Circuit
          </button>
          <button
            type="button"
            onClick={() => setEditing(!editing)}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            {editing ? 'Cancel' : 'Edit Policy'}
          </button>
        </div>
      </div>

      {notification && (
        <div className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notification}</div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <p className="text-xl font-bold text-gray-900">{successRate}%</p>
          <p className="text-xs text-gray-500">Success Rate</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <p className="text-xl font-bold text-amber-600">{metrics.retryCount}</p>
          <p className="text-xs text-gray-500">Retries</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <p className="text-xl font-bold text-orange-600">{metrics.timeoutCount}</p>
          <p className="text-xs text-gray-500">Timeouts</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3 text-center">
          <p className="text-xl font-bold text-red-600">{metrics.circuitBreakerTrips}</p>
          <p className="text-xs text-gray-500">CB Trips</p>
        </div>
      </div>

      <div className="mt-4 divide-y divide-gray-100">
        <MetricRow label="Last Failure" value={metrics.lastFailureAt ? new Date(metrics.lastFailureAt).toLocaleString() : 'Never'} />
      </div>

      {editing && (
        <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700">Edit Policy</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Max Retries</span>
              <input
                type="number" min={0} max={10}
                value={draft.maxRetries ?? policy.maxRetries}
                onChange={e => setDraft(d => ({ ...d, maxRetries: parseInt(e.target.value, 10) }))}
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Backoff Strategy</span>
              <select
                value={draft.backoffStrategy ?? policy.backoffStrategy}
                onChange={e => setDraft(d => ({ ...d, backoffStrategy: e.target.value as BackoffStrategy }))}
                className="rounded border px-2 py-1 text-sm"
              >
                <option value="exponential">Exponential</option>
                <option value="linear">Linear</option>
                <option value="fibonacci">Fibonacci</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Timeout (ms)</span>
              <input
                type="number" min={500} max={300000}
                value={draft.timeoutMs ?? policy.timeoutMs}
                onChange={e => setDraft(d => ({ ...d, timeoutMs: parseInt(e.target.value, 10) }))}
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">Max Concurrent</span>
              <input
                type="number" min={1} max={100}
                value={draft.maxConcurrent ?? policy.maxConcurrent}
                onChange={e => setDraft(d => ({ ...d, maxConcurrent: parseInt(e.target.value, 10) }))}
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">CB Threshold (0–1)</span>
              <input
                type="number" min={0.1} max={1} step={0.05}
                value={draft.circuitBreakerThreshold ?? policy.circuitBreakerThreshold}
                onChange={e => setDraft(d => ({ ...d, circuitBreakerThreshold: parseFloat(e.target.value) }))}
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-gray-500">CB Cooldown (ms)</span>
              <input
                type="number" min={1000} max={300000}
                value={draft.circuitCooldownMs ?? policy.circuitCooldownMs}
                onChange={e => setDraft(d => ({ ...d, circuitCooldownMs: parseInt(e.target.value, 10) }))}
                className="rounded border px-2 py-1 text-sm"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Policy'}
          </button>
        </div>
      )}
    </div>
  );
}
