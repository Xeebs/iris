'use client';

import { useEffect, useState, useCallback } from 'react';
import { ConnectorHealthGrid } from '../../../components/connector-health-grid.js';
import { SlaComplianceTracker } from '../../../components/sla-compliance-tracker.js';
import { IncidentResponsePanel } from '../../../components/incident-response-panel.js';

type Tab = 'grid' | 'sla' | 'incidents';

type HealthEntry = {
  connectorId: string;
  overallScore: number;
  grade: string;
  syncSuccessRate: number;
  entityFreshness: number;
  errorFrequency: number;
  authValidity: number;
  scoredAt: string;
};

type HealthAlert = {
  alertId: string;
  connectorId: string;
  alertType: string;
  severity: 'warning' | 'critical';
  message: string;
  currentScore?: number | null;
  baselineScore?: number | null;
  createdAt: string;
};

type SlaBreach = {
  breachId: string;
  breachType: string;
  actualValue: number;
  targetValue: number;
  breachStartedAt: string;
  breachResolvedAt?: string | null;
  description?: string | null;
};

const WORKSPACE_ID = 'default';

export default function ConnectorHealthScorecardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('grid');
  const [healthEntries, setHealthEntries] = useState<HealthEntry[]>([]);
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [breaches, setBreaches] = useState<SlaBreach[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHealthSummary = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/health-scorecards/health-summary?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: HealthEntry[] };
        setHealthEntries(body.data ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/health-scorecards/incidents?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: HealthAlert[] };
        setAlerts(body.data ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchBreaches = useCallback(async (connectorId: string) => {
    try {
      const res = await fetch(`/api/v1/health-scorecards/${connectorId}/sla-breaches?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: SlaBreach[] };
        setBreaches(body.data ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    void Promise.allSettled([fetchHealthSummary(), fetchIncidents()]).finally(() => setLoading(false));
  }, [fetchHealthSummary, fetchIncidents]);

  useEffect(() => {
    if (selectedConnector) void fetchBreaches(selectedConnector);
  }, [selectedConnector, fetchBreaches]);

  async function handleResolveAlert(alertId: string) {
    await fetch(`/api/v1/health-scorecards/incidents/${alertId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId: WORKSPACE_ID }),
      headers: { 'Content-Type': 'application/json' },
    });
    await fetchIncidents();
  }

  async function handleTakeAction(connectorId: string, actionType: string) {
    await fetch(`/api/v1/health-scorecards/${connectorId}/recovery`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, actionType }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function getRecommendations(connectorId: string) {
    const res = await fetch(`/api/v1/health-scorecards/${connectorId}/recovery-suggestions?workspaceId=${WORKSPACE_ID}`);
    if (res.ok) {
      const body = (await res.json()) as { data: Array<{ actionType: 're-auth' | 'manual-sync' | 'pause' | 'retry'; reason: string; priority: number }> };
      return body.data ?? [];
    }
    return [];
  }

  const activeAlertCount = alerts.length;

  const TABS: Array<[Tab, string, number?]> = [
    ['grid', 'Connector Grid'],
    ['sla', 'SLA Compliance'],
    ['incidents', 'Incidents', activeAlertCount > 0 ? activeAlertCount : undefined],
  ];

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Connector Health Scorecard</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {loading && <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Refreshing…</span>}
          <button
            onClick={() => { setLoading(true); void Promise.allSettled([fetchHealthSummary(), fetchIncidents()]).finally(() => setLoading(false)); }}
            style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e5e7eb', marginBottom: '1.25rem' }}>
        {TABS.map(([tab, label, badge]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab ? '#3b82f6' : '#6b7280',
              fontWeight: activeTab === tab ? 600 : 400, fontSize: '0.875rem', marginBottom: -2,
            }}
          >
            {label}
            {badge !== undefined && (
              <span style={{ marginLeft: 5, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '0 5px', fontSize: '0.7rem', fontWeight: 700 }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'grid' && (
        <ConnectorHealthGrid
          entries={healthEntries}
          selectedConnectorId={selectedConnector ?? undefined}
          onSelectConnector={(id) => { setSelectedConnector(id); setActiveTab('sla'); }}
        />
      )}

      {activeTab === 'sla' && (
        <div>
          {healthEntries.length > 0 && (
            <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {healthEntries.map((e) => (
                <button
                  key={e.connectorId}
                  onClick={() => setSelectedConnector(e.connectorId)}
                  style={{
                    padding: '0.25rem 0.6rem', border: `1px solid ${selectedConnector === e.connectorId ? '#3b82f6' : '#d1d5db'}`,
                    borderRadius: 4, background: selectedConnector === e.connectorId ? '#eff6ff' : '#fff',
                    color: selectedConnector === e.connectorId ? '#3b82f6' : '#374151',
                    cursor: 'pointer', fontSize: '0.8125rem',
                  }}
                >
                  {e.connectorId}
                </button>
              ))}
            </div>
          )}
          <SlaComplianceTracker
            connectorId={selectedConnector ?? 'none'}
            breaches={breaches}
          />
        </div>
      )}

      {activeTab === 'incidents' && (
        <IncidentResponsePanel
          alerts={alerts}
          onResolve={handleResolveAlert}
          onTakeAction={(connectorId, actionType) => handleTakeAction(connectorId, actionType)}
          getRecommendations={getRecommendations}
        />
      )}
    </div>
  );
}
