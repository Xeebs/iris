'use client';

import { useState } from 'react';
import { ValidationRuleBuilder } from '@/components/validation-rule-builder';
import { ValidationFailureExplorer } from '@/components/validation-failure-explorer';

type Tab = 'rules' | 'failures' | 'report';

export default function DataQualityRulesPage() {
  const [tab, setTab] = useState<Tab>('rules');
  const workspaceId =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('workspaceId') ?? '')
      : '';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Data Quality Rules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define validation rules that are enforced at sync time to catch malformed or incomplete
          entity data.
        </p>
      </div>

      <div className="flex gap-2 border-b border-border">
        {(['rules', 'failures', 'report'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'rules' ? 'Validation Rules' : t === 'failures' ? 'Failures' : 'Report'}
          </button>
        ))}
      </div>

      {tab === 'rules' && <ValidationRuleBuilder workspaceId={workspaceId} />}
      {tab === 'failures' && <ValidationFailureExplorer workspaceId={workspaceId} />}
      {tab === 'report' && <ValidationReportPanel workspaceId={workspaceId} />}
    </div>
  );
}

// ─── Inline report panel (lightweight, no extra component file needed) ────────

function ValidationReportPanel({ workspaceId }: { workspaceId: string }) {
  const [report, setReport] = useState<{
    totalEntities: number;
    validCount: number;
    invalidCount: number;
    warningCount: number;
    failuresByRule: { ruleId: string; ruleName: string; count: number }[];
    generatedAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadReport() {
    if (!workspaceId) {
      setError('workspaceId query param is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/validation/report?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as { data: typeof report };
      setReport(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={loadReport}
        disabled={loading}
        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50"
      >
        {loading ? 'Loading…' : 'Generate Report'}
      </button>

      {error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Entities', value: report.totalEntities },
              { label: 'Valid', value: report.validCount },
              { label: 'Invalid', value: report.invalidCount },
              { label: 'Warnings', value: report.warningCount },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg border border-border p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
              </div>
            ))}
          </div>

          {report.failuresByRule.length > 0 && (
            <div className="rounded-lg border border-border">
              <div className="p-4 border-b border-border text-sm font-medium">
                Failures by Rule
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Rule Name</th>
                    <th className="text-right px-4 py-2 font-medium">Failure Count</th>
                  </tr>
                </thead>
                <tbody>
                  {report.failuresByRule.map((r) => (
                    <tr key={r.ruleId} className="border-t border-border">
                      <td className="px-4 py-2">{r.ruleName}</td>
                      <td className="px-4 py-2 text-right font-mono">{r.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Generated at: {new Date(report.generatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
