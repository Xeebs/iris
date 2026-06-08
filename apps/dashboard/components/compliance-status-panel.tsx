'use client';

type ComplianceFramework = 'hipaa' | 'soc2' | 'gdpr' | 'ccpa';
type RetentionStatus = 'compliant' | 'review_needed' | 'non_compliant';

interface ComplianceReport {
  framework: ComplianceFramework;
  totalEvents: number;
  periodStart: string;
  periodEnd: string;
  uniqueUsers: number;
  piiAccessCount: number;
  anomaliesDetected: number;
  dataRetentionStatus: RetentionStatus;
  openDsrCount: number;
}

interface ComplianceStatusPanelProps {
  report: ComplianceReport;
  framework: ComplianceFramework;
}

const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  hipaa: 'HIPAA',
  soc2: 'SOC 2',
  gdpr: 'GDPR',
  ccpa: 'CCPA',
};

const STATUS_CONFIG: Record<RetentionStatus, { label: string; color: string; bg: string }> = {
  compliant: { label: 'Compliant', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  review_needed: { label: 'Review Needed', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  non_compliant: { label: 'Non-Compliant', color: 'text-red-700', bg: 'bg-red-50 border-red-200' },
};

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${warn ? 'text-orange-500' : 'text-gray-800'}`}>{value}</p>
    </div>
  );
}

/**
 * Summary panel for a single compliance framework's current report status.
 */
export function ComplianceStatusPanel({ report, framework }: ComplianceStatusPanelProps) {
  const status = STATUS_CONFIG[report.dataRetentionStatus];

  return (
    <div className={`rounded-xl border p-5 ${status.bg}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-gray-800">{FRAMEWORK_LABELS[framework]}</h3>
        <span className={`text-sm font-medium ${status.color}`}>{status.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Total Events" value={report.totalEvents.toLocaleString()} />
        <Stat label="Unique Users" value={report.uniqueUsers} />
        <Stat label="PII Accesses" value={report.piiAccessCount} warn={report.piiAccessCount > 50} />
        <Stat label="Anomalies" value={report.anomaliesDetected} warn={report.anomaliesDetected > 0} />
        <Stat label="Open DSRs" value={report.openDsrCount} warn={report.openDsrCount > 0} />
        <Stat
          label="Period"
          value={`${new Date(report.periodStart).toLocaleDateString()} – ${new Date(report.periodEnd).toLocaleDateString()}`}
        />
      </div>
    </div>
  );
}
