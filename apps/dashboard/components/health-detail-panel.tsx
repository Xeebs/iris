'use client';

type HealthBreakdown = {
  connectorId: string;
  workspaceId: string;
  overallScore: number;
  syncSuccessRate: number;
  entityFreshness: number;
  errorFrequency: number;
  authValidity: number;
  scoredAt: string;
};

type HistoryPoint = {
  overallScore: number;
  scoredAt: string;
};

type RecoveryRec = {
  actionType: 're-auth' | 'manual-sync' | 'pause' | 'retry';
  reason: string;
  priority: number;
};

type HealthDetailPanelProps = {
  connectorId: string;
  connectorName: string;
  breakdown: HealthBreakdown;
  history: HistoryPoint[];
  recommendations: RecoveryRec[];
  onExecuteAction: (actionType: RecoveryRec['actionType']) => void;
  executingAction: string | null;
};

function scoreColor(score: number) {
  if (score >= 80) return '#16a34a';
  if (score >= 60) return '#d97706';
  return '#dc2626';
}

const ACTION_LABELS: Record<string, string> = {
  're-auth': 'Re-authenticate',
  'manual-sync': 'Trigger Sync',
  'pause': 'Pause Connector',
  'retry': 'Retry',
};

/**
 * Full scoring breakdown and recovery panel for a single connector.
 */
export function HealthDetailPanel({
  connectorId, connectorName, breakdown, history, recommendations, onExecuteAction, executingAction,
}: HealthDetailPanelProps) {
  const subScores = [
    { label: 'Sync Success Rate', value: breakdown.syncSuccessRate, weight: '40%' },
    { label: 'Entity Freshness', value: breakdown.entityFreshness, weight: '30%' },
    { label: 'Error Frequency', value: breakdown.errorFrequency, weight: '20%' },
    { label: 'Auth Validity', value: breakdown.authValidity, weight: '10%' },
  ];

  const sparkMax = Math.max(...history.map(h => h.overallScore), 1);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{connectorName}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{connectorId}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44, fontWeight: 900, color: scoreColor(breakdown.overallScore), lineHeight: 1 }}>{breakdown.overallScore}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>/ 100</div>
        </div>
      </div>

      {/* Score breakdown */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Score Breakdown</div>
        {subScores.map(s => (
          <div key={s.label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ color: '#374151' }}>{s.label}</span>
              <span style={{ color: '#6b7280', fontSize: 11 }}>weight {s.weight} · {(s.value * 100).toFixed(0)}%</span>
            </div>
            <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${s.value * 100}%`, background: scoreColor(s.value * 100), borderRadius: 3, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        ))}
      </div>

      {/* History sparkline */}
      {history.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>Score History</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48, background: '#f9fafb', borderRadius: 6, padding: '6px 8px' }}>
            {history.map((h, i) => (
              <div
                key={i}
                title={`${h.overallScore} on ${new Date(h.scoredAt).toLocaleDateString()}`}
                style={{ flex: 1, height: `${(h.overallScore / sparkMax) * 100}%`, background: scoreColor(h.overallScore), borderRadius: '1px 1px 0 0', minHeight: 2 }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
            <span>{new Date(history[0]!.scoredAt).toLocaleDateString()}</span>
            <span>{new Date(history[history.length - 1]!.scoredAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      {/* Recovery recommendations */}
      {recommendations.length > 0 && (
        <div>
          <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 13 }}>Recovery Actions</div>
          {recommendations.map(r => (
            <div key={r.actionType} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontWeight: 600, color: '#374151' }}>{ACTION_LABELS[r.actionType] ?? r.actionType}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{r.reason}</div>
              </div>
              <button
                onClick={() => onExecuteAction(r.actionType)}
                disabled={executingAction === r.actionType}
                style={{ padding: '5px 14px', background: executingAction === r.actionType ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: executingAction === r.actionType ? 'not-allowed' : 'pointer' }}
              >
                {executingAction === r.actionType ? '…' : 'Execute'}
              </button>
            </div>
          ))}
        </div>
      )}

      {recommendations.length === 0 && (
        <div style={{ padding: 14, background: '#f0fdf4', borderRadius: 8, color: '#16a34a', fontSize: 12, textAlign: 'center' }}>
          Connector is healthy — no recovery actions needed.
        </div>
      )}
    </div>
  );
}
