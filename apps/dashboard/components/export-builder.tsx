'use client';

import { useState } from 'react';

type ExportFormat = 'json' | 'csv';

type ExportConfig = {
  format: ExportFormat;
  entityType: string;
  updatedAfter: string;
};

type Props = {
  workspaceId?: string;
};

export function ExportBuilder({ workspaceId = 'default' }: Props) {
  const [config, setConfig] = useState<ExportConfig>({
    format: 'json',
    entityType: '',
    updatedAfter: '',
  });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<{ fileName: string; timestamp: Date } | null>(null);

  async function runExport() {
    setExporting(true);
    setError(null);

    const params = new URLSearchParams({ format: config.format });
    if (config.entityType) params.set('type', config.entityType);
    if (config.updatedAfter) params.set('updatedAfter', new Date(config.updatedAfter).toISOString());

    try {
      const res = await fetch(`/api/v1/entities/export?${params.toString()}`, {
        headers: { 'x-workspace-id': workspaceId },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: { message: string } };
        setError(body.error?.message ?? `Export failed (HTTP ${res.status})`);
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] ?? `entities-export.${config.format}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      setLastExport({ fileName, timestamp: new Date() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Format</label>
          <div className="flex gap-4">
            {(['json', 'csv'] as ExportFormat[]).map((f) => (
              <label key={f} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="export-format"
                  value={f}
                  checked={config.format === f}
                  onChange={() => setConfig((c) => ({ ...c, format: f }))}
                />
                <span className="text-sm font-mono uppercase">{f}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Entity type <span className="text-gray-400 font-normal">(leave blank for all)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. contact, deal, company"
            value={config.entityType}
            onChange={(e) => setConfig((c) => ({ ...c, entityType: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Updated after <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="datetime-local"
            value={config.updatedAfter}
            onChange={(e) => setConfig((c) => ({ ...c, updatedAfter: e.target.value }))}
            className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <button
        onClick={runExport}
        disabled={exporting}
        className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting ? 'Exporting…' : `Export as ${config.format.toUpperCase()}`}
      </button>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>
      )}

      {lastExport && (
        <p className="text-sm text-green-600">
          Exported <span className="font-mono">{lastExport.fileName}</span> at{' '}
          {lastExport.timestamp.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
