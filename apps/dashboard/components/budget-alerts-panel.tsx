'use client';

type BudgetSeverity = 'info' | 'warning' | 'critical';

type BudgetAlert = {
  workspaceId: string;
  thresholdPct: number;
  severity: BudgetSeverity;
  triggeredAt: string;
  acknowledgedAt: string | null;
  notificationChannels: string[];
};

const SEVERITY_STYLES: Record<BudgetSeverity, { bg: string; text: string; border: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', label: 'Critical' },
  warning: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', label: 'Warning' },
  info: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', label: 'Info' },
};

type BudgetAlertsPanelProps = {
  alerts: BudgetAlert[];
  onAcknowledge?: (alert: BudgetAlert) => void;
  loading?: boolean;
};

export function BudgetAlertsPanel({ alerts, onAcknowledge, loading = false }: BudgetAlertsPanelProps) {
  const active = alerts.filter((a) => !a.acknowledgedAt);
  const acknowledged = alerts.filter((a) => a.acknowledgedAt);

  if (alerts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Budget Alerts</h3>
        <p className="text-sm text-gray-400 text-center py-6">No active budget alerts.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Budget Alerts</h3>
        {active.length > 0 && (
          <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
            {active.length} active
          </span>
        )}
      </div>

      <ul className="divide-y divide-gray-100">
        {active.map((alert, i) => {
          const styles = SEVERITY_STYLES[alert.severity];
          return (
            <li key={i} className={`px-5 py-3 ${styles.bg} border-l-4 ${styles.border}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-semibold uppercase tracking-wide ${styles.text}`}>
                      {styles.label}
                    </span>
                    <span className={`text-xs ${styles.text}`}>{alert.thresholdPct}% threshold reached</span>
                  </div>
                  <p className={`text-xs ${styles.text}`}>
                    {new Date(alert.triggeredAt).toLocaleString()} · via {alert.notificationChannels.join(', ') || 'in-app'}
                  </p>
                </div>
                {onAcknowledge && (
                  <button
                    onClick={() => onAcknowledge(alert)}
                    disabled={loading}
                    className={`text-xs px-2 py-1 rounded border ${styles.border} ${styles.text} hover:opacity-80 disabled:opacity-50 transition-opacity flex-shrink-0`}
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </li>
          );
        })}

        {acknowledged.length > 0 && (
          <li className="px-5 py-2 bg-gray-50">
            <p className="text-xs text-gray-400">{acknowledged.length} acknowledged alert(s) hidden</p>
          </li>
        )}
      </ul>
    </div>
  );
}
