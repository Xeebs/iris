'use client';

import React, { useState, useRef } from 'react';

interface DetectedSchema {
  columns: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
}

interface FieldMapping {
  entityType: string;
  labelColumn: string;
  idColumn?: string;
  attributeMap: Record<string, string>;
}

interface ImportWizardProps {
  workspaceId: string;
  onComplete: (result: { jobId: string; inserted: number; skipped: number }) => void;
}

type Step = 'upload' | 'map' | 'preview' | 'done';

export function ImportWizard({ workspaceId, onComplete }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('upload');
  const [content, setContent] = useState('');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [schema, setSchema] = useState<DetectedSchema | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({
    entityType: 'record',
    labelColumn: '',
    attributeMap: {},
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    const text = await file.text();
    setContent(text);
    setFormat(file.name.endsWith('.json') ? 'json' : 'csv');
  };

  const detectSchema = async () => {
    if (!content) { setError('Please select a file first'); return; }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/data/import/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, format }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message ?? 'Schema detection failed'); return; }
      setSchema(json.data);
      if (json.data.columns[0]) {
        setMapping((m) => ({ ...m, labelColumn: json.data.columns[0] }));
      }
      setStep('map');
    } finally {
      setIsLoading(false);
    }
  };

  const executeImport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/data/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, content, format, mapping }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error?.message ?? 'Import failed'); return; }
      setStep('done');
      onComplete(json.data);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {step === 'upload' && (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <input ref={fileInputRef} type="file" accept=".csv,.json" onChange={handleFileChange} className="hidden" />
          <p className="text-gray-600 mb-4">Upload a CSV or JSON file (max 100 MB)</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Choose File
          </button>
          {content && (
            <div className="mt-4">
              <p className="text-sm text-green-600">File loaded ({(content.length / 1024).toFixed(1)} KB)</p>
              <button
                onClick={detectSchema}
                disabled={isLoading}
                className="mt-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {isLoading ? 'Detecting…' : 'Detect Schema'}
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'map' && schema && (
        <div className="space-y-4">
          <h3 className="font-medium">Field Mapping ({schema.rowCount} rows detected)</h3>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-gray-700">Entity Type</span>
              <input
                type="text"
                value={mapping.entityType}
                onChange={(e) => setMapping((m) => ({ ...m, entityType: e.target.value }))}
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Label Column</span>
              <select
                value={mapping.labelColumn}
                onChange={(e) => setMapping((m) => ({ ...m, labelColumn: e.target.value }))}
                className="mt-1 block w-full border rounded px-2 py-1 text-sm"
              >
                {schema.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep('upload')} className="px-3 py-1.5 border rounded text-sm">Back</button>
            <button
              onClick={() => setStep('preview')}
              className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm"
            >
              Preview
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && schema && (
        <div className="space-y-4">
          <h3 className="font-medium">Preview (first 5 rows)</h3>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>{schema.columns.map((c) => <th key={c} className="border px-2 py-1 bg-gray-50">{c}</th>)}</tr>
              </thead>
              <tbody>
                {schema.sampleRows.map((row, i) => (
                  <tr key={i}>{schema.columns.map((c) => <td key={c} className="border px-2 py-1">{row[c] ?? ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep('map')} className="px-3 py-1.5 border rounded text-sm">Back</button>
            <button
              onClick={executeImport}
              disabled={isLoading}
              className="px-3 py-1.5 bg-green-600 text-white rounded text-sm disabled:opacity-50"
            >
              {isLoading ? 'Importing…' : `Import ${schema.rowCount} rows`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
