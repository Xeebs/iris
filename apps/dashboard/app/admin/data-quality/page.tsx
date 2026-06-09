'use client';

import { useState, useCallback } from 'react';
import { DataQualityScanForm } from '@/components/data-quality-scan-form';
import { DataQualityIssuesTable } from '@/components/data-quality-issues-table';

type Issue = {
  issue_id: string;
  scan_id: string;
  entity_id: string;
  issue_type: string;
  severity: 'low' | 'medium' | 'high';
  field_name: string | null;
  resolved_at: string | null;
  connector_id?: string;
};

type ScanResult = {
  scan_id: string;
  connector_id: string;
  status: string;
  total_entities: number;
  issues_found: number;
  completed_at: string | null;
};

type ReportSummary = {
  totalIssues: number;
  openIssues: number;
  resolvedIssues: number;
  bySeverity: { high: number; medium: number; low: number };
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export default function DataQualityPage() {
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = useCallback(async (connectorId: string) => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/data-quality/scans/${encodeURIComponent(connectorId)}`, {
        method: 'POST',
      });
      const body = await res.json() as { data?: ScanResult; error?: { message: string } };
      if (!res.ok || !body.data) throw new Error(body.error?.message ?? 'Scan failed');

      setLastScan(body.data);

      const scanRes = await fetch(`${API_BASE}/data-quality/scans/${body.data.scan_id}`);
      const scanBody = await scanRes.json() as { data?: { issues: Issue[] } };
      if (scanBody.data) setIssues(scanBody.data.issues);

      await loadReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      throw err;
    } finally {
      setScanning(false);
    }
  }, []);

  const loadReport = async () => {
    try {
      const res = await fetch(`${API_BASE}/data-quality/report`);
      const body = await res.json() as { data?: { summary: ReportSummary } };
      if (body.data) setReport(body.data.summary);
    } catch {
      // non-fatal
    }
  };

  const resolveIssue = useCallback(async (issueId: string) => {
    setResolvingId(issueId);
    try {
      const res = await fetch(`${API_BASE}/data-quality/issues/${issueId}/resolve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to resolve issue');
      setIssues((prev) =>
        prev.map((i) => (i.issue_id === issueId ? { ...i, resolved_at: new Date().toISOString() } : i))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve issue');
    } finally {
      setResolvingId(null);
    }
  }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Data Quality</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Scan connectors for schema violations, missing fields, and data anomalies.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {report && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Issues', value: report.totalIssues },
            { label: 'Open', value: report.openIssues },
            { label: 'Resolved', value: report.resolvedIssues },
            { label: 'High Severity', value: report.bySeverity.high },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3">
              <div className="text-2xl font-semibold text-zinc-100">{value}</div>
              <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 space-y-3">
        <h2 className="text-sm font-medium text-zinc-300">Run Quality Scan</h2>
        <DataQualityScanForm onScanStart={runScan} loading={scanning} />
        {lastScan && (
          <p className="text-xs text-zinc-500">
            Last scan: {lastScan.connector_id} — {lastScan.issues_found} issues found across{' '}
            {lastScan.total_entities} entities ({lastScan.status})
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-zinc-300">
          Issues {issues.length > 0 && <span className="text-zinc-500">({issues.length})</span>}
        </h2>
        <DataQualityIssuesTable issues={issues} onResolve={resolveIssue} resolvingId={resolvingId} />
      </div>
    </div>
  );
}
