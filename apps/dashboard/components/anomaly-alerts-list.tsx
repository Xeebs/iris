'use client';

import { useState } from 'react';

type AlertType = 'bulk_access' | 'off_hours' | 'pii_overaccess';

type AnomalyAlert = {
  alertType: AlertType;
  userId: string;
  entityIdsInvolved: string[];
  confidence: number;
  flaggedAt: string;
  details: string;
};

type Props = {
  alerts: AnomalyAlert[];
  onRefresh?: () => void;
};

const ALERT_LABELS: Record<AlertType, { label: string; color: string; bg: string }> = {
  bulk_access: { label: 'Bulk Access', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
  off_hours: { label: 'Off-Hours', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  pii_overaccess: { label: 'PII Overaccess', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
};

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'bg-red-100 text-red-700' : pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{pct}% confidence</span>;
}

function AlertRow({ alert, expanded, onToggle }: {
  alert: AnomalyAlert;
  expanded: boolean;
  onToggle: () => void;
}) {
  const style = ALERT_LABELS[alert.alertType];
  const ts = new Date(alert.flaggedAt).toLocaleString();

  return (
    <div className={`border rounded-lg p-4 space-y-2 ${style.bg}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-semibold ${style.color}`}>{style.label}</span>
          <ConfidenceBadge value={alert.confidence} />
        </div>
        <button onClick={onToggle} className="text-xs text-gray-500 hover:text-gray-700">
          {expanded ? 'Hide details' : 'Investigate'}
        </button>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-600">
        <span>User: <span className="font-medium text-gray-900 font-mono">{alert.userId}</span></span>
        <span>{ts}</span>
      </div>

      <p className="text-sm text-gray-700">{alert.details}</p>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-current/10 space-y-2">
          <p className="text-xs font-medium text-gray-600">Affected Entities ({alert.entityIdsInvolved.length})</p>
          <div className="flex flex-wrap gap-1">
            {alert.entityIdsInvolved.slice(0, 10).map(id => (
              <span key={id} className="px-2 py-0.5 bg-white border rounded text-xs font-mono text-gray-700">{id}</span>
            ))}
            {alert.entityIdsInvolved.length > 10 && (
              <span className="px-2 py-0.5 text-xs text-gray-500">+{alert.entityIdsInvolved.length - 10} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnomalyAlertsList({ alerts, onRefresh }: Props) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<AlertType | 'all'>('all');

  const filtered = filterType === 'all' ? alerts : alerts.filter(a => a.alertType === filterType);
  const byType = {
    bulk_access: alerts.filter(a => a.alertType === 'bulk_access').length,
    off_hours: alerts.filter(a => a.alertType === 'off_hours').length,
    pii_overaccess: alerts.filter(a => a.alertType === 'pii_overaccess').length,
  };

  if (alerts.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <svg className="w-10 h-10 mx-auto mb-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="font-medium text-green-700">No anomalies detected</p>
        <p className="text-sm mt-1">Access patterns are within normal bounds</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {(['all', 'bulk_access', 'off_hours', 'pii_overaccess'] as const).map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium border
                ${filterType === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}
            >
              {t === 'all' ? `All (${alerts.length})` : `${ALERT_LABELS[t].label} (${byType[t]})`}
            </button>
          ))}
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="text-sm text-blue-600 hover:text-blue-800">
            Refresh
          </button>
        )}
      </div>

      <div className="space-y-3">
        {filtered.map((alert, i) => (
          <AlertRow
            key={`${alert.userId}-${alert.alertType}-${i}`}
            alert={alert}
            expanded={expandedIdx === i}
            onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
          />
        ))}
      </div>
    </div>
  );
}
