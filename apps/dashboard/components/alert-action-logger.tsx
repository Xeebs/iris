'use client';

import { useEffect, useState } from 'react';

type Alert = {
  id: number;
  alertType: string;
  reason: string;
  createdAt: string;
  suppressed: boolean;
  acknowledged: boolean;
};

type Mitigation = {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
};

type Props = {
  connectorId: string;
  onSuppressAlert?: (alertType: string) => Promise<void>;
};

const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

const ALERT_TYPE_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-amber-100 text-amber-700',
  anomaly: 'bg-purple-100 text-purple-700',
  forecast: 'bg-blue-100 text-blue-700',
};

/**
 * Displays alert history and mitigation actions for a connector.
 */
export function AlertActionLogger({ connectorId, onSuppressAlert }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [mitigations, setMitigations] = useState<Mitigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/connectors/${connectorId}/alerts`)
      .then((r) => r.json())
      .then((body) => {
        setAlerts(body.data?.alerts ?? []);
        setMitigations(body.data?.mitigations ?? []);
      })
      .catch(() => setError('Failed to load alerts'))
      .finally(() => setLoading(false));
  }, [connectorId]);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-2 rounded-lg border border-gray-200 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Mitigation recommendations */}
      {mitigations.length > 0 && (
        <div className="border-b border-gray-100 p-4">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">Recommended Actions</h3>
          <div className="space-y-2">
            {mitigations.map((m, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${PRIORITY_STYLES[m.priority]}`}
                >
                  {m.priority}
                </span>
                <div>
                  <p className="text-xs font-medium text-gray-800">{m.action}</p>
                  <p className="text-xs text-gray-500">{m.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alert history */}
      <div className="p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">Alert History</h3>
        {alerts.length === 0 ? (
          <p className="text-sm text-gray-400">No alerts recorded.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start justify-between rounded-md px-3 py-2 ${
                  alert.suppressed ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start gap-2 min-w-0">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      ALERT_TYPE_STYLES[alert.alertType] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {alert.alertType}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-gray-700">{alert.reason}</p>
                    <p className="mt-0.5 text-[10px] text-gray-400">{formatDate(alert.createdAt)}</p>
                  </div>
                </div>
                {!alert.suppressed && onSuppressAlert && (
                  <button
                    className="ml-2 shrink-0 text-[10px] text-gray-400 hover:text-gray-700"
                    onClick={() => onSuppressAlert(alert.alertType)}
                    type="button"
                  >
                    Suppress
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
