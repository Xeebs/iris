'use client';

import { useState } from 'react';

type ExportFormat = 'json' | 'csv';
type ComplianceFormat = 'soc2' | 'gdpr' | 'hipaa' | '';

type ExportResult = {
  exportId: string;
  signature: string;
  totalRecords: number;
};

type Props = {
  workspaceId: string;
  onExportComplete?: (result: ExportResult) => void;
};

export function AuditExportWizard({ workspaceId, onExportComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [complianceFormat, setComplianceFormat] = useState<ComplianceFormat>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        workspaceId,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        format,
        requestedByUserId: 'current-user',
      };
      if (complianceFormat) body.complianceFormat = complianceFormat;

      const res = await fetch('/api/v1/compliance/audit-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json() as { error: { message: string } };
        throw new Error(err.error?.message ?? 'Export failed');
      }
      const data = await res.json() as { data: ExportResult };
      setResult(data.data);
      setStep(3);
      onExportComplete?.(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border rounded-lg p-6 bg-white space-y-6">
      <div className="flex items-center gap-3">
        {([1, 2, 3] as const).map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium
              ${step >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {s}
            </div>
            {s < 3 && <div className={`w-12 h-0.5 ${step > s ? 'bg-blue-600' : 'bg-gray-200'}`} />}
          </div>
        ))}
        <span className="text-sm text-gray-500 ml-2">
          {step === 1 ? 'Date Range' : step === 2 ? 'Format' : 'Complete'}
        </span>
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Select Date Range</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!startDate || !endDate}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h3 className="font-medium text-gray-900">Choose Export Format</h3>
          <div className="space-y-2">
            <label className="block text-sm text-gray-600">Output Format</label>
            <div className="flex gap-3">
              {(['json', 'csv'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`px-4 py-2 rounded border text-sm font-medium
                    ${format === f ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-sm text-gray-600">Compliance Template (optional)</label>
            <div className="flex gap-3 flex-wrap">
              {(['', 'soc2', 'gdpr', 'hipaa'] as const).map(f => (
                <button
                  key={f || 'none'}
                  onClick={() => setComplianceFormat(f)}
                  className={`px-4 py-2 rounded border text-sm font-medium
                    ${complianceFormat === f ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}
                >
                  {f ? f.toUpperCase() : 'None'}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="px-4 py-2 border rounded text-sm text-gray-700">Back</button>
            <button
              onClick={handleExport}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Export'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-medium">Export generated successfully</span>
          </div>
          <div className="bg-gray-50 rounded p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Export ID</span>
              <span className="font-mono text-gray-900">{result.exportId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total Records</span>
              <span className="text-gray-900">{result.totalRecords?.toLocaleString() ?? '—'}</span>
            </div>
            <div>
              <span className="text-gray-500 block mb-1">Signature</span>
              <span className="font-mono text-xs text-gray-700 break-all block bg-white border rounded p-2">
                {result.signature?.slice(0, 64)}...
              </span>
            </div>
          </div>
          <button
            onClick={() => { setStep(1); setResult(null); setStartDate(''); setEndDate(''); }}
            className="px-4 py-2 border rounded text-sm text-gray-700"
          >
            New Export
          </button>
        </div>
      )}
    </div>
  );
}
