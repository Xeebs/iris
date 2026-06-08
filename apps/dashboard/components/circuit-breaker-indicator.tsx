'use client';

import { useState, useEffect, useCallback } from 'react';

type CircuitState = 'closed' | 'open' | 'half_open';

type CircuitStatus = {
  connectorId: string;
  state: CircuitState;
  failCount: number;
  successCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  updatedAt: string;
};

type Props = {
  connectorId: string;
  workspaceId?: string;
  onReset?: () => void;
};

const STATE_CONFIG: Record<CircuitState, { label: string; color: string; dot: string; bg: string }> = {
  closed: {
    label: 'Healthy',
    color: 'text-green-700',
    dot: 'bg-green-500',
    bg: 'bg-green-50 border-green-200',
  },
  half_open: {
    label: 'Recovering',
    color: 'text-yellow-700',
    dot: 'bg-yellow-400',
    bg: 'bg-yellow-50 border-yellow-200',
  },
  open: {
    label: 'Open (degraded)',
    color: 'text-red-700',
    dot: 'bg-red-500',
    bg: 'bg-red-50 border-red-200',
  },
};

export function CircuitBreakerIndicator({ connectorId, workspaceId = 'default', onReset }: Props) {
  const [status, setStatus] = useState<CircuitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/connectors/${connectorId}/circuit-status`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      const body = await res.json() as { data?: CircuitStatus; error?: { message: string } };
      if (body.data) {
        setStatus(body.data);
        setError(null);
      } else {
        setError(body.error?.message ?? 'Failed to load circuit status');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [connectorId, workspaceId]);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 15_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  async function handleReset() {
    setResetting(true);
    try {
      await fetch(`/api/v1/admin/connectors/${connectorId}/circuit-reset`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      await fetchStatus();
      onReset?.();
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-gray-400">
        <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse" />
        Loading…
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-red-500">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        {error ?? 'Unknown status'}
      </div>
    );
  }

  const cfg = STATE_CONFIG[status.state];

  return (
    <div className={`border rounded-lg p-3 ${cfg.bg}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ${status.state === 'open' ? 'animate-pulse' : ''}`} />
          <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
        </div>
        {status.state !== 'closed' && (
          <button
            onClick={handleReset}
            disabled={resetting}
            className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:bg-gray-50 text-gray-600 disabled:opacity-50"
          >
            {resetting ? 'Resetting…' : 'Reset circuit'}
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
        <div>Failures: <span className={`font-medium ${status.failCount > 0 ? 'text-red-600' : 'text-gray-700'}`}>{status.failCount}</span></div>
        <div>Successes: <span className="font-medium text-gray-700">{status.successCount}</span></div>
        {status.lastFailureAt && (
          <div className="col-span-2">
            Last failure: {new Date(status.lastFailureAt).toLocaleTimeString()}
          </div>
        )}
        {status.state === 'open' && status.openedAt && (
          <div className="col-span-2 text-yellow-600">
            Auto-recover in ~{Math.max(0, Math.round((30_000 - (Date.now() - new Date(status.openedAt).getTime())) / 1000))}s
          </div>
        )}
      </div>
    </div>
  );
}
