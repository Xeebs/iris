'use client';

import { useState } from 'react';

type ExportOptions = {
  entityTypes: string;
  includeGlossary: boolean;
  includeMetrics: boolean;
  since: string;
};

type ImportResult = {
  totalNodes: number;
  imported: { entities: number; glossaryTerms: number; metrics: number };
  skipped: number;
  errors: { nodeId: string; message: string }[];
};

type Props = {
  workspaceId?: string;
};

export function OsiExportWizard({ workspaceId = 'default' }: Props) {
  const [tab, setTab] = useState<'export' | 'import'>('export');
  const [exportOpts, setExportOpts] = useState<ExportOptions>({
    entityTypes: '',
    includeGlossary: true,
    includeMetrics: true,
    since: '',
  });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importRaw, setImportRaw] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function runExport() {
    setExporting(true);
    setExportError(null);
    const params = new URLSearchParams({
      workspaceId,
      includeGlossary: String(exportOpts.includeGlossary),
      includeMetrics: String(exportOpts.includeMetrics),
    });
    if (exportOpts.entityTypes) params.set('entityTypes', exportOpts.entityTypes);
    if (exportOpts.since) params.set('since', new Date(exportOpts.since).toISOString());

    try {
      const res = await fetch(`/api/v1/export/osi?${params.toString()}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message: string } };
        setExportError(body.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      const text = await res.text();
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `osi-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function runImport() {
    setImporting(true);
    setImportError(null);
    setImportResult(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(importRaw);
    } catch {
      setImportError('Invalid JSON — paste a valid OSI document');
      setImporting(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/workspace/import/osi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify(parsed),
      });
      const body = await res.json() as { data?: ImportResult; error?: { message: string } };
      if (body.data) {
        setImportResult(body.data);
      } else {
        setImportError(body.error?.message ?? 'Import failed');
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex border-b border-gray-200">
        {(['export', 'import'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'export' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Export entities, glossary terms, and metrics as an OSI 1.0 JSON-LD document for interoperability with other semantic tools.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Entity types <span className="text-gray-400 font-normal">(comma-separated, blank for all)</span>
              </label>
              <input
                type="text"
                placeholder="contact, deal, company"
                value={exportOpts.entityTypes}
                onChange={(e) => setExportOpts((o) => ({ ...o, entityTypes: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Updated since</label>
              <input
                type="datetime-local"
                value={exportOpts.since}
                onChange={(e) => setExportOpts((o) => ({ ...o, since: e.target.value }))}
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="flex gap-6">
            {[
              { key: 'includeGlossary' as const, label: 'Include glossary terms' },
              { key: 'includeMetrics' as const, label: 'Include metrics' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={exportOpts[key]}
                  onChange={(e) => setExportOpts((o) => ({ ...o, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>

          <button
            onClick={runExport}
            disabled={exporting}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export OSI Document'}
          </button>

          {exportError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{exportError}</p>}
        </div>
      )}

      {tab === 'import' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Paste an OSI JSON-LD document to import entities, glossary terms, and metrics into this workspace.
            Records are upserted — existing items are updated, new ones are created.
          </p>

          <textarea
            className="w-full h-64 font-mono text-xs p-3 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder='{"@context": {...}, "@graph": [...], "workspaceId": "...", ...}'
            value={importRaw}
            onChange={(e) => setImportRaw(e.target.value)}
            spellCheck={false}
          />

          <button
            onClick={runImport}
            disabled={importing || !importRaw.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import OSI Document'}
          </button>

          {importError && <p className="text-sm text-red-600 bg-red-50 rounded p-2">{importError}</p>}

          {importResult && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
              <div className="font-medium text-sm text-green-800">Import complete</div>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-gray-500">Total nodes</div><div className="font-semibold">{importResult.totalNodes}</div></div>
                <div><div className="text-xs text-gray-500">Entities</div><div className="font-semibold text-green-700">{importResult.imported.entities}</div></div>
                <div><div className="text-xs text-gray-500">Glossary</div><div className="font-semibold text-green-700">{importResult.imported.glossaryTerms}</div></div>
                <div><div className="text-xs text-gray-500">Metrics</div><div className="font-semibold text-green-700">{importResult.imported.metrics}</div></div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {importResult.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
                      <span className="font-mono">{e.nodeId}</span>: {e.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
