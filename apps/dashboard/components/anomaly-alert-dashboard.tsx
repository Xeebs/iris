'use client';

import { useState, useEffect, useCallback } from 'react';

type AlertType = 'unusual_time' | 'bulk_export' | 'new_location' | 'high_volume' | 'pii_access';
type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

interface AnomalyAlert {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  userId: string;
  description: string;
  acknowledged: boolean;
  createdAt: string;
}

interface AnomalyAlertDashboardProps {
  workspaceId: string;
}

const SEVERITY_CONFIG: Record<AlertSeverity, { label: string; border: string; bg: string; text: string }> = {
  critical: { label: 'Critical', border: 'border-red-300', bg: 'bg-red-50', text: 'text-red-800' },
  high: { label: 'High', border: 'border-orange-200', bg: 'bg-orange-50', text: 'text-orange-800' },
  medium: { label: 'Medium', border: 'border-yellow-200', bg: 'bg-yellow-50', text: 'text-yellow-800' },
  low: { label: 'Low', border: 'border-gray-200', bg: 'bg-gray-50', text: 'text-gray-700' },
};

const ALERT_TYPE_ICONS: Record<AlertType, string> = {
  unusual_time: '🕐',
  bulk_export: '📤',
  new_location: '📍',
  high_volume: '📊',
  pii_access: '🔒',
};

/**
 * Dashboard showing open anomaly alerts with one-click acknowledgement.
 */
export function AnomalyAlertDashboard({ workspaceId }: AnomalyAlertDashboardProps) {
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/compliance/alerts', {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = (await res.json()) as { data: AnomalyAlert[] };
      setAlerts(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void fetchAlerts(); }, [fetchAlerts]);

  const handleAcknowledge = async (alertId: string) => {
    setAcknowledging(alertId);
    try {
      const res = await fetch(`/api/v1/compliance/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error(`Ack failed: ${res.status}`);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acknowledge failed');
    } finally {
      setAcknowledging(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}
      </div>
    );
  }

  if (error) {
    return <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>;
  }

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-center text-sm text-green-700">
        No open anomaly alerts. All access patterns look normal.
      </div>
    );
  }

  const critical = alerts.filter((a) => a.severity === 'critical' || a.severity === 'high');
  const other = alerts.filter((a) => a.severity === 'medium' || a.severity === 'low');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">
          Open Alerts
          <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{alerts.length}</span>
        </h4>
        <button
          type="button"
          onClick={() => void fetchAlerts()}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Refresh
        </button>
      </div>

      {[...critical, ...other].map((alert) => {
        const cfg = SEVERITY_CONFIG[alert.severity];
        return (
          <div key={alert.id} className={`rounded-lg border p-3 ${cfg.border} ${cfg.bg}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${cfg.text}`}>
                  <span className="mr-1.5">{ALERT_TYPE_ICONS[alert.alertType]}</span>
                  {alert.description}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  User: {alert.userId} · {new Date(alert.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cfg.text} ${cfg.bg} border ${cfg.border}`}>
                  {cfg.label}
                </span>
                <button
                  type="button"
                  disabled={acknowledging === alert.id}
                  onClick={() => void handleAcknowledge(alert.id)}
                  className="rounded-md border border-current px-2 py-1 text-xs font-medium opacity-70 hover:opacity-100 disabled:opacity-40"
                >
                  {acknowledging === alert.id ? '…' : 'Ack'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
