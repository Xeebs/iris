'use client';

import { useState } from 'react';

type CorruptionIssue = {
  issueType: 'orphaned_vector' | 'missing_vector' | 'broken_relationship' | 'stale_entity';
  entityId: string;
  detail: string;
};

type IntegrityReport = {
  workspaceId: string;
  scannedAt: string;
  totalEntitiesScanned: number;
  issues: CorruptionIssue[];
  orphanedVectorCount: number;
  missingVectorCount: number;
  brokenRelationshipCount: number;
  isHealthy: boolean;
};

interface IndexCorruptionDetectorProps {
  workspaceId: string;
}

const ISSUE_LABELS: Record<CorruptionIssue['issueType'], string> = {
  orphaned_vector: 'Orphaned Vector',
  missing_vector: 'Missing Vector',
  broken_relationship: 'Broken Relationship',
  stale_entity: 'Stale Entity',
};

/**
 * Runs an on-demand index integrity scan and displays detected corruption issues.
 */
export function IndexCorruptionDetector({ workspaceId }: IndexCorruptionDetectorProps) {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runScan() {
    if (!workspaceId) {
      setError('workspaceId is required');
      return;
    }
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/index-repair/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { data: IntegrityReport };
      setReport(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Corruption Detection</h2>
        <button
          onClick={() => void runScan()}
          disabled={scanning}
          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Run Integrity Scan'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          <div
            className={`rounded-lg border p-4 flex items-center gap-3 ${
              report.isHealthy
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-destructive/50 bg-destructive/10 text-destructive'
            }`}
          >
            <span className="text-lg">{report.isHealthy ? '✓' : '✗'}</span>
            <div>
              <p className="font-medium">
                {report.isHealthy ? 'Index is healthy' : `${report.issues.length} issue(s) detected`}
              </p>
              <p className="text-xs mt-0.5">
                {report.totalEntitiesScanned.toLocaleString()} entities scanned ·{' '}
                {new Date(report.scannedAt).toLocaleString()}
              </p>
            </div>
          </div>

          {!report.isHealthy && (
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Orphaned Vectors', count: report.orphanedVectorCount },
                { label: 'Missing Vectors', count: report.missingVectorCount },
                { label: 'Broken Relationships', count: report.brokenRelationshipCount },
              ].map(({ label, count }) => (
                <div key={label} className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div
                    className={`text-2xl font-bold mt-1 ${
                      count > 0 ? 'text-destructive' : 'text-foreground'
                    }`}
                  >
                    {count}
                  </div>
                </div>
              ))}
            </div>
          )}

          {report.issues.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-sm font-medium bg-muted/50">
                Issues ({report.issues.length})
              </div>
              <div className="divide-y divide-border max-h-64 overflow-y-auto">
                {report.issues.map((issue, idx) => (
                  <div key={idx} className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                        {ISSUE_LABELS[issue.issueType]}
                      </span>
                      <code className="text-xs text-muted-foreground">{issue.entityId}</code>
                    </div>
                    <p className="text-muted-foreground mt-1">{issue.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!report && !scanning && (
        <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          Click &ldquo;Run Integrity Scan&rdquo; to check the index for corruption.
        </div>
      )}
    </div>
  );
}
