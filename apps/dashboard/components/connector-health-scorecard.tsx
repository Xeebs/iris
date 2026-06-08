'use client';

import { useState, useEffect } from 'react';

type HealthScore = {
  connectorId: string;
  workspaceId: string;
  overallScore: number;
  syncSuccessRate: number;
  entityFreshness: number;
  errorFrequency: number;
  authValidity: number;
  scoredAt: string;
};

type HealthAlert = {
  alertId: string;
  alertType: 'degradation' | 'auth_expiry' | 'sync_failure' | 'stale_data';
  severity: 'warning' | 'critical';
  message: string;
  currentScore: number | null;
  baselineScore: number | null;
  createdAt: string;
};

type RecoverySuggestion = {
  actionType: 're-auth' | 'manual-sync' | 'pause' | 'retry';
  reason: string;
  priority: number;
};

type Props = {
  connectorId: string;
  workspaceId: string;
  apiBase?: string;
};

function ScoreMeter({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
  const label = score >= 80 ? 'Healthy' : score >= 50 ? 'Degraded' : 'Critical';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: `6px solid ${color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          fontWeight: 700,
          color,
        }}
      >
        {score}
      </div>
      <div>
        <p style={{ margin: 0, fontWeight: 600, color }}>{label}</p>
        <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280' }}>Health Score</p>
      </div>
    </div>
  );
}

function SubScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.75rem', color: '#374151' }}>{label}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color }}>{pct}%</span>
      </div>
      <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}

function AlertCard({ alert, onAcknowledge }: { alert: HealthAlert; onAcknowledge: (id: string) => void }) {
  const borderColor = alert.severity === 'critical' ? '#ef4444' : '#f59e0b';
  const bg = alert.severity === 'critical' ? '#fef2f2' : '#fffbeb';

  return (
    <div style={{ padding: '12px 16px', background: bg, border: `1px solid ${borderColor}`, borderRadius: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, color: borderColor }}>
            {alert.severity}
          </span>
          <p style={{ margin: '4px 0', fontSize: '0.875rem', color: '#111827' }}>{alert.message}</p>
          {alert.currentScore !== null && alert.baselineScore !== null && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280' }}>
              Score: {alert.currentScore} (baseline: {alert.baselineScore})
            </p>
          )}
        </div>
        <button
          onClick={() => onAcknowledge(alert.alertId)}
          style={{
            padding: '4px 10px',
            fontSize: '0.75rem',
            background: '#fff',
            border: `1px solid ${borderColor}`,
            borderRadius: 4,
            cursor: 'pointer',
            color: borderColor,
            flexShrink: 0,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function RecoveryCard({ suggestion }: { suggestion: RecoverySuggestion }) {
  const icons: Record<string, string> = {
    'retry': '↺',
    're-auth': '🔑',
    'manual-sync': '⟳',
    'pause': '⏸',
  };

  return (
    <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 8, display: 'flex', gap: 10 }}>
      <span style={{ fontSize: '1.25rem' }}>{icons[suggestion.actionType] ?? '•'}</span>
      <div>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.8rem', color: '#166534', textTransform: 'capitalize' }}>
          {suggestion.actionType.replace('-', ' ')}
        </p>
        <p style={{ margin: 0, fontSize: '0.75rem', color: '#374151' }}>{suggestion.reason}</p>
      </div>
    </div>
  );
}

export function ConnectorHealthScorecard({ connectorId, workspaceId, apiBase = '/api/v1' }: Props) {
  const [score, setScore] = useState<HealthScore | null>(null);
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [suggestions, setSuggestions] = useState<RecoverySuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts' | 'fixes'>('overview');

  const headers = { 'x-workspace-id': workspaceId };

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [scoreRes, suggestRes] = await Promise.all([
        fetch(`${apiBase}/connectors/${connectorId}/health`, { headers }),
        fetch(`${apiBase}/connectors/${connectorId}/recovery-suggestions`, { headers }),
      ]);

      if (scoreRes.ok) {
        const data = await scoreRes.json() as { data: { score: HealthScore | null; alerts: HealthAlert[] } | HealthScore };
        if ('score' in (data.data as object)) {
          const nested = data.data as { score: HealthScore | null; alerts: HealthAlert[] };
          setScore(nested.score);
          setAlerts(nested.alerts ?? []);
        } else {
          setScore(data.data as HealthScore);
        }
      }

      if (suggestRes.ok) {
        const sData = await suggestRes.json() as { data: RecoverySuggestion[] };
        setSuggestions(sData.data ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health data');
    } finally {
      setLoading(false);
    }
  }

  async function handleAcknowledge(alertId: string) {
    await fetch(`${apiBase}/connectors/${connectorId}/health/acknowledge`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alertId }),
    });
    setAlerts((prev) => prev.filter((a) => a.alertId !== alertId));
  }

  async function handleRecovery(action: RecoverySuggestion) {
    await fetch(`${apiBase}/connectors/${connectorId}/recovery-action`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionType: action.actionType }),
    });
    await loadAll();
  }

  useEffect(() => { void loadAll(); }, [connectorId, workspaceId]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>
        Loading health data…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#b91c1c' }}>
        {error}
      </div>
    );
  }

  const tabs: Array<{ id: typeof activeTab; label: string; badge?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'alerts', label: 'Alerts', badge: alerts.length },
    { id: 'fixes', label: 'Suggested Fixes', badge: suggestions.length },
  ];

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#111827' }}>
            {connectorId} — Health Monitor
          </h3>
          {score && (
            <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>
              Last checked: {new Date(score.scoredAt).toLocaleString()}
            </p>
          )}
        </div>
        <button
          onClick={() => void loadAll()}
          style={{ padding: '6px 12px', fontSize: '0.8rem', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer' }}
        >
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '10px 16px',
              fontSize: '0.875rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid #6366f1' : '2px solid transparent',
              color: activeTab === t.id ? '#6366f1' : '#6b7280',
              cursor: 'pointer',
              fontWeight: activeTab === t.id ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {t.label}
            {t.badge !== undefined && t.badge > 0 && (
              <span style={{ background: '#ef4444', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: '0.7rem' }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 20 }}>
        {activeTab === 'overview' && score && (
          <>
            <div style={{ marginBottom: 20 }}>
              <ScoreMeter score={score.overallScore} />
            </div>
            <div style={{ marginTop: 16 }}>
              <p style={{ margin: '0 0 10px', fontSize: '0.8rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase' }}>
                Score Breakdown
              </p>
              <SubScoreBar label="Sync Success Rate" value={score.syncSuccessRate} />
              <SubScoreBar label="Entity Freshness" value={score.entityFreshness} />
              <SubScoreBar label="Error Frequency" value={score.errorFrequency} />
              <SubScoreBar label="Auth Validity" value={score.authValidity} />
            </div>
          </>
        )}

        {activeTab === 'overview' && !score && (
          <p style={{ color: '#9ca3af', textAlign: 'center', margin: '24px 0' }}>
            No health score available yet. Sync this connector to generate metrics.
          </p>
        )}

        {activeTab === 'alerts' && (
          <>
            {alerts.length === 0 ? (
              <p style={{ color: '#9ca3af', textAlign: 'center', margin: '24px 0' }}>No active alerts.</p>
            ) : (
              alerts.map((alert) => (
                <AlertCard key={alert.alertId} alert={alert} onAcknowledge={handleAcknowledge} />
              ))
            )}
          </>
        )}

        {activeTab === 'fixes' && (
          <>
            {suggestions.length === 0 ? (
              <p style={{ color: '#9ca3af', textAlign: 'center', margin: '24px 0' }}>No recovery suggestions — connector is healthy.</p>
            ) : (
              suggestions.map((s, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <RecoveryCard suggestion={s} />
                  <button
                    onClick={() => void handleRecovery(s)}
                    style={{
                      marginTop: 4,
                      padding: '4px 12px',
                      fontSize: '0.75rem',
                      background: '#6366f1',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Apply Fix
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
