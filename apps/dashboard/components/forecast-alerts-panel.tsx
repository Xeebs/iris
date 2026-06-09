'use client';

import React from 'react';

export type ForecastAlert = {
  alertId: string;
  severity: 'warning' | 'critical';
  predictedIssue: string;
  daysUntilThreshold: number;
  currentScore: number | null;
  predictedScore: number | null;
  recommendedAction: string | null;
  createdAt: string;
};

type Props = {
  connectorId: string;
  alerts: ForecastAlert[];
  onAcknowledge?: (alertId: string) => void;
};

const SEVERITY_STYLES = {
  critical: 'border-red-300 bg-red-50',
  warning: 'border-orange-300 bg-orange-50',
};

const SEVERITY_BADGE = {
  critical: 'bg-red-100 text-red-700',
  warning: 'bg-orange-100 text-orange-700',
};

const ISSUE_LABELS: Record<string, string> = {
  health_decline: 'Health Decline',
  high_latency: 'High Latency',
  high_error_rate: 'High Error Rate',
  data_staleness: 'Data Staleness',
};

export function ForecastAlertsPanel({ connectorId, alerts, onAcknowledge }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 border border-dashed rounded-lg">
        No active forecast alerts for {connectorId}.
      </div>
    );
  }

  const critical = alerts.filter((a) => a.severity === 'critical');
  const warning = alerts.filter((a) => a.severity === 'warning');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Predictive Alerts — {connectorId}</h3>
        <div className="flex gap-2 text-xs">
          {critical.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
              {critical.length} critical
            </span>
          )}
          {warning.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
              {warning.length} warning
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {alerts.map((alert) => (
          <div
            key={alert.alertId}
            className={`p-4 border rounded-lg ${SEVERITY_STYLES[alert.severity]}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_BADGE[alert.severity]}`}>
                    {alert.severity}
                  </span>
                  <span className="text-sm font-medium text-gray-800">
                    {ISSUE_LABELS[alert.predictedIssue] ?? alert.predictedIssue}
                  </span>
                </div>

                <p className="text-sm text-gray-700">
                  Expected in <strong>{alert.daysUntilThreshold} day{alert.daysUntilThreshold !== 1 ? 's' : ''}</strong>
                  {alert.predictedScore !== null && (
                    <> — predicted score: <strong>{alert.predictedScore.toFixed(0)}</strong></>
                  )}
                </p>

                {alert.recommendedAction && (
                  <p className="text-xs text-gray-600 italic">{alert.recommendedAction}</p>
                )}

                <p className="text-xs text-gray-400">
                  Detected {new Date(alert.createdAt).toLocaleString()}
                </p>
              </div>

              {onAcknowledge && (
                <button
                  type="button"
                  onClick={() => onAcknowledge(alert.alertId)}
                  className="shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-white transition-colors"
                >
                  Acknowledge
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
