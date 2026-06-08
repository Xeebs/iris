'use client';

import React, { useState } from 'react';

interface ExportConfiguratorProps {
  workspaceId: string;
}

export function ExportConfigurator({ workspaceId }: ExportConfiguratorProps) {
  const [format, setFormat] = useState<'csv' | 'json'>('json');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerExport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId,
        format,
        limit: String(limit),
        ...(entityType ? { entityType } : {}),
      });

      const res = await fetch(`/api/v1/data/export?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? 'Export failed');
        return;
      }

      const blob = await res.blob();
      const jobId = res.headers.get('X-Job-Id') ?? 'export';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${jobId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-gray-700">Format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}
            className="mt-1 block w-full border rounded px-2 py-1 text-sm"
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm text-gray-700">Entity Type (optional)</span>
          <input
            type="text"
            value={entityType}
            placeholder="e.g. contact"
            onChange={(e) => setEntityType(e.target.value)}
            className="mt-1 block w-full border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm text-gray-700">Max Records</span>
          <input
            type="number"
            value={limit}
            min={1}
            max={50000}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 block w-full border rounded px-2 py-1 text-sm"
          />
        </label>
      </div>
      <button
        onClick={triggerExport}
        disabled={isLoading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
      >
        {isLoading ? 'Exporting…' : `Export as ${format.toUpperCase()}`}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
