'use client';

import { useEffect, useState, useCallback } from 'react';
import { ConnectorLineageDiagram } from '../../../components/connector-lineage-diagram.js';
import { AuditTrailTable } from '../../../components/audit-trail-table.js';
import { RetentionPolicyEditor } from '../../../components/retention-policy-editor.js';
import { ComplianceBadge } from '../../../components/compliance-badge.js';
import { DsrQueue } from '../../../components/dsr-queue.js';

type Tab = 'lineage' | 'audit' | 'retention' | 'compliance' | 'dsr';

type LineageNode = { id: string; connectorId: string; entityType: string; entityCount: number };
type AuditEvent = {
  eventId: string; actor: string; action: string; resourceType: string;
  resourceId: string; durationMs: number; bytesReturned: number; createdAt: string;
};
type RetentionPolicy = { policyId?: string; connectorId: string; entityType: string; ttlDays: number; isActive: boolean };
type ComplianceData = {
  gdprStatus: string; hipaaStatus: string; soc2Status: string;
  gdprCertExpiresAt?: string | null; hipaaCertExpiresAt?: string | null; soc2CertExpiresAt?: string | null;
};
type DsrRequest = {
  requestId: string; requesterEmail: string;
  requestType: 'deletion' | 'export' | 'rectification' | 'access';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  entityCount: number; notes?: string | null; submittedAt: string;
  completedAt?: string | null; deadlineAt: string;
};

const WORKSPACE_ID = 'default';

export default function DataGovernancePage() {
  const [activeTab, setActiveTab] = useState<Tab>('lineage');
  const [lineageNodes, setLineageNodes] = useState<LineageNode[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [compliance, setCompliance] = useState<ComplianceData | null>(null);
  const [dsrRequests, setDsrRequests] = useState<DsrRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLineage = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/governance/lineage?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: { nodes: LineageNode[] } };
        setLineageNodes(body.data.nodes ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchAudit = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/governance/audit-summary?workspaceId=${WORKSPACE_ID}&limit=50`);
      if (res.ok) {
        const body = (await res.json()) as { data: { events: AuditEvent[] } };
        setAuditEvents(body.data.events ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchPolicies = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/governance/retention-policies?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: RetentionPolicy[] };
        setPolicies(body.data ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchCompliance = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/governance/compliance-status?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: ComplianceData };
        setCompliance(body.data);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchDsr = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/governance/dsr-queue?workspaceId=${WORKSPACE_ID}`);
      if (res.ok) {
        const body = (await res.json()) as { data: DsrRequest[] };
        setDsrRequests(body.data ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    setLoading(true);
    void Promise.allSettled([fetchLineage(), fetchAudit(), fetchPolicies(), fetchCompliance(), fetchDsr()])
      .finally(() => setLoading(false));
  }, [fetchLineage, fetchAudit, fetchPolicies, fetchCompliance, fetchDsr]);

  async function handleSavePolicy(policy: Omit<RetentionPolicy, 'policyId'>) {
    const res = await fetch('/api/v1/governance/retention-policies', {
      method: 'POST',
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, ...policy }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) await fetchPolicies();
  }

  async function handleComplianceUpdate(standard: 'GDPR' | 'HIPAA' | 'SOC2', status: string) {
    const key = `${standard.toLowerCase()}Status`;
    await fetch('/api/v1/governance/compliance-status', {
      method: 'PUT',
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, [key]: status }),
      headers: { 'Content-Type': 'application/json' },
    });
    await fetchCompliance();
  }

  async function handleDsrStatusChange(requestId: string, status: DsrRequest['status']) {
    await fetch(`/api/v1/governance/dsr-queue/${requestId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
      headers: { 'Content-Type': 'application/json' },
    });
    await fetchDsr();
  }

  const pendingDsr = dsrRequests.filter((r) => r.status === 'pending').length;

  const TABS: Array<[Tab, string, number?]> = [
    ['lineage', 'Data Lineage'],
    ['audit', 'Audit Trail'],
    ['retention', 'Retention Policies'],
    ['compliance', 'Compliance'],
    ['dsr', 'DSR Queue', pendingDsr > 0 ? pendingDsr : undefined],
  ];

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Data Governance & Compliance</h1>
        {loading && <span style={{ fontSize: '0.875rem', color: '#9ca3af' }}>Loading…</span>}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '2px solid #e5e7eb' }}>
        {TABS.map(([tab, label, badge]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab ? '#3b82f6' : '#6b7280',
              fontWeight: activeTab === tab ? 600 : 400, fontSize: '0.875rem', marginBottom: -2,
              position: 'relative',
            }}
          >
            {label}
            {badge !== undefined && (
              <span style={{ marginLeft: 6, background: '#ef4444', color: '#fff', borderRadius: 10, padding: '0 5px', fontSize: '0.7rem', fontWeight: 700 }}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'lineage' && (
        <div>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: 0, marginBottom: '1rem' }}>
            Data flow from source connectors through the indexer and cache to MCP consumers.
          </p>
          <ConnectorLineageDiagram nodes={lineageNodes} />
        </div>
      )}

      {activeTab === 'audit' && (
        <AuditTrailTable events={auditEvents} />
      )}

      {activeTab === 'retention' && (
        <RetentionPolicyEditor
          policies={policies}
          onSave={handleSavePolicy}
        />
      )}

      {activeTab === 'compliance' && (
        <div>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: 0, marginBottom: '1rem' }}>
            Track regulatory compliance status and certificate expiry for your workspace.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {(['GDPR', 'HIPAA', 'SOC2'] as const).map((standard) => (
              <ComplianceBadge
                key={standard}
                standard={standard}
                status={(compliance?.[`${standard.toLowerCase()}Status` as keyof ComplianceData] as string ?? 'not_assessed') as Parameters<typeof ComplianceBadge>[0]['status']}
                certExpiresAt={compliance?.[`${standard.toLowerCase()}CertExpiresAt` as keyof ComplianceData] as string | null | undefined}
                onUpdate={(status) => void handleComplianceUpdate(standard, status)}
              />
            ))}
          </div>
        </div>
      )}

      {activeTab === 'dsr' && (
        <div>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: 0, marginBottom: '1rem' }}>
            Data subject requests (GDPR/CCPA) — deletion, export, rectification, and access requests.
          </p>
          <DsrQueue requests={dsrRequests} onStatusChange={handleDsrStatusChange} />
        </div>
      )}
    </div>
  );
}
