'use client';

import { useState, useRef } from 'react';

type ImportResult = {
  jobId: string;
  status: string;
  totalRecords: number;
  importedCount: number;
  errorCount: number;
  errors: { row: number; field: string; message: string }[];
};

type PreviewRow = { id: string; type: string; label: string };
type Step = 'upload' | 'preview' | 'result';

interface ImportWizardProps {
  workspaceId?: string;
  onComplete?: (result: ImportResult) => void;
}

export function ImportWizard({ workspaceId = 'default', onComplete }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [fileData, setFileData] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError(null);
    const detectedFormat = file.name.endsWith('.csv') ? 'csv' : 'json';
    setFormat(detectedFormat);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setFileData(text);

      try {
        let rows: PreviewRow[];
        if (detectedFormat === 'json') {
          const parsed = JSON.parse(text) as PreviewRow[];
          if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
          rows = parsed.slice(0, 5).map((r) => ({ id: String(r.id ?? ''), type: String(r.type ?? ''), label: String(r.label ?? '') }));
        } else {
          const lines = text.trim().split('\n');
          if (lines.length < 2) throw new Error('CSV needs a header row and at least one data row');
          const headers = lines[0]!.split(',').map((h) => h.trim());
          rows = lines.slice(1, 6).map((line) => {
            const vals = line.split(',');
            const rec: Record<string, string> = {};
            headers.forEach((h, i) => { rec[h] = vals[i]?.trim() ?? ''; });
            return { id: rec['id'] ?? '', type: rec['type'] ?? '', label: rec['label'] ?? '' };
          });
        }
        setPreview(rows);
        setStep('preview');
      } catch (e) {
        setParseError(e instanceof Error ? e.message : 'Failed to parse file');
      }
    };
    reader.readAsText(file);
  }

  async function runImport() {
    if (!fileData) return;
    setImporting(true);
    try {
      const res = await fetch('/api/v1/entities/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ format, fileName, data: fileData }),
      });
      const body = await res.json() as { data?: ImportResult; error?: { message: string } };
      if (body.data) {
        setResult(body.data);
        setStep('result');
        onComplete?.(body.data);
      } else {
        setParseError(body.error?.message ?? 'Import failed');
      }
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep('upload');
    setFileData(null);
    setFileName('');
    setPreview([]);
    setParseError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'preview', 'result'] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <span className="text-gray-300">→</span>}
            <span className={step === s ? 'font-semibold text-blue-600 capitalize' : 'text-gray-400 capitalize'}>{s}</span>
          </span>
        ))}
      </div>

      {step === 'upload' && (
        <div className="space-y-4">
          <div className="flex gap-4">
            {(['json', 'csv'] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} />
                <span className="text-sm uppercase font-mono">{f}</span>
              </label>
            ))}
          </div>
          <div
            className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-gray-500 text-sm">Click to select a <span className="font-mono">.{format}</span> file</p>
            <p className="text-xs text-gray-400 mt-1">JSON: array of entity objects · CSV: id, type, label, attributes, relationships</p>
            <input ref={fileInputRef} type="file" accept=".json,.csv" className="hidden" onChange={handleFileChange} />
          </div>
          {parseError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{parseError}</p>}
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">File: <span className="font-mono">{fileName}</span> · Preview (first {preview.length} rows)</p>
          <div className="overflow-x-auto border border-gray-200 rounded">
            <table className="text-xs w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['id', 'type', 'label'].map((col) => (
                    <th key={col} className="px-3 py-2 text-left font-medium text-gray-600 uppercase tracking-wide">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((rec, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono">{rec.id || <span className="text-red-400">missing</span>}</td>
                    <td className="px-3 py-2">{rec.type || <span className="text-red-400">missing</span>}</td>
                    <td className="px-3 py-2">{rec.label || <span className="text-red-400">missing</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3">
            <button onClick={runImport} disabled={importing} className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {importing ? 'Importing…' : 'Confirm Import'}
            </button>
            <button onClick={reset} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200">Back</button>
          </div>
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
        </div>
      )}

      {step === 'result' && result && (
        <div className="space-y-4">
          <div className={`rounded-lg p-4 ${result.status === 'completed' ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
            <div className="font-medium text-sm mb-2">Import {result.status === 'completed' ? 'complete' : 'finished with errors'}</div>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><div className="text-xs text-gray-500">Total</div><div className="font-semibold">{result.totalRecords}</div></div>
              <div><div className="text-xs text-gray-500">Imported</div><div className="font-semibold text-green-600">{result.importedCount}</div></div>
              <div><div className="text-xs text-gray-500">Errors</div><div className={`font-semibold ${result.errorCount > 0 ? 'text-red-600' : 'text-gray-500'}`}>{result.errorCount}</div></div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {result.errors.map((err, i) => (
                <div key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
                  Row {err.row} · <span className="font-mono">{err.field}</span>: {err.message}
                </div>
              ))}
            </div>
          )}
          <button onClick={reset} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm rounded hover:bg-gray-200">Import another file</button>
        </div>
      )}
    </div>
  );
}
