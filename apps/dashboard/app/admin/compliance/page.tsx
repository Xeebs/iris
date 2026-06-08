'use client';

import { useState, useEffect, useCallback } from 'react';

import { ComplianceStatusPanel } from '../../../components/compliance-status-panel.js';
import { AuditLogExplorer } from '../../../components/audit-log-explorer.js';
import { AnomalyAlertDashboard } from '../../../components/anomaly-alert-dashboard.js';

type ComplianceFramework = 'hipaa' | 'soc2' | 'gdpr' | 'ccpa';

interface ComplianceReport {
  framework: ComplianceFramework;
  totalEvents: number;
  periodStart: string;
  periodEnd: string;
  uniqueUsers: number;
  piiAccessCount: number;
  anomaliesDetected: number;
  dataRetentionStatus: 'compliant' | 'review_needed' | 'non_compliant';
  openDsrCount: number;
}

const FRAMEWORKS: ComplianceFramework[] = ['hipaa', 'soc2', 'gdpr', 'ccpa'];
const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  hipaa: 'HIPAA', soc2: 'SOC 2', gdpr: 'GDPR', ccpa: 'CCPA',
};

const DEFAULT_WORKSPACE = 'default';

type Tab = 'overview' | 'audit-log' | 'alerts' | 'dsrs';

/**
 * Compliance & Audit Reporting admin page.
 * Shows framework status across HIPAA/SOC2/GDPR/CCPA, audit log explorer,
 * anomaly alerts, and data subject requests.
 */
export default function CompliancePage() {
  const workspaceId = DEFAULT_WORKSPACE;
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [reports, setReports] = useState<Record<ComplianceFramework, ComplianceReport | null>>({
    hipaa: null, soc2: null, gdpr: null, ccpa: null,
  });
  const [loadingFramework, setLoadingFramework] = useState<ComplianceFramework | null>(null);
  const [selectedFramework, setSelectedFramework] = useState<ComplianceFramework>('gdpr');

  const loadReport = useCallback(async (framework: ComplianceFramework) => {
    if (reports[framework]) return;
    setLoadingFramework(framework);
    try {
      const res = await fetch(`/api/v1/compliance/report/${framework}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (res.ok) {
        const json = (await res.json()) as { data: ComplianceReport };
        setReports((prev) => ({ ...prev, [framework]: json.data }));
      }
    } finally {
      setLoadingFramework(null);
    }
  }, [workspaceId, reports]);

  useEffect(() => {
    void loadReport('gdpr');
  }, []);

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Framework Overview' },
    { id: 'audit-log', label: 'Audit Log' },
    { id: 'alerts', label: 'Anomaly Alerts' },
    { id: 'dsrs', label: 'Data Requests' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance & Audit</h1>
        <p className="mt-1 text-sm text-gray-500">
          Regulatory compliance status, audit trails, and data subject requests for your workspace.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Framework selector */}
          <div className="flex gap-2">
            {FRAMEWORKS.map((fw) => (
              <button
                key={fw}
                type="button"
                onClick={() => { setSelectedFramework(fw); void loadReport(fw); }}
                className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
                  selectedFramework === fw
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {FRAMEWORK_LABELS[fw]}
              </button>
            ))}
          </div>

          {loadingFramework === selectedFramework ? (
            <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
          ) : reports[selectedFramework] ? (
            <ComplianceStatusPanel report={reports[selectedFramework]!} framework={selectedFramework} />
          ) : (
            <div className="flex h-32 items-center justify-center rounded-xl border border-gray-200 text-sm text-gray-400">
              Click a framework tab above to load the report.
            </div>
          )}

          {/* Summary grid for all frameworks */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {FRAMEWORKS.map((fw) => {
              const r = reports[fw];
              return (
                <div
                  key={fw}
                  className={`rounded-xl border p-3 cursor-pointer transition-shadow hover:shadow-md ${
                    selectedFramework === fw ? 'border-indigo-300 shadow-sm' : 'border-gray-200'
                  }`}
                  onClick={() => { setSelectedFramework(fw); void loadReport(fw); }}
                >
                  <p className="text-xs font-semibold text-gray-500">{FRAMEWORK_LABELS[fw]}</p>
                  {r ? (
                    <p className={`mt-1 text-sm font-medium ${
                      r.dataRetentionStatus === 'compliant' ? 'text-green-600' : 'text-orange-500'
                    }`}>
                      {r.dataRetentionStatus === 'compliant' ? 'Compliant' : 'Review Needed'}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-400">Not loaded</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'audit-log' && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-800">Audit Log</h2>
          <AuditLogExplorer workspaceId={workspaceId} />
        </div>
      )}

      {activeTab === 'alerts' && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-800">Anomaly Alerts</h2>
          <AnomalyAlertDashboard workspaceId={workspaceId} />
        </div>
      )}

      {activeTab === 'dsrs' && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-800">Data Subject Requests</h2>
          <p className="text-sm text-gray-500 mb-4">
            Submit and track GDPR Article 15/17, CCPA, and HIPAA data access/deletion requests.
          </p>
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <p className="text-sm text-gray-400">DSR management UI — submit requests via POST /api/v1/compliance/dsr.</p>
          </div>
        </div>
      )}
    </div>
  );
}
