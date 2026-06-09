'use client';

import { useState } from 'react';

type ScanFormProps = {
  onScanStart: (connectorId: string) => Promise<void>;
  loading?: boolean;
};

export function DataQualityScanForm({ onScanStart, loading = false }: ScanFormProps) {
  const [connectorId, setConnectorId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectorId.trim()) {
      setError('Connector ID is required');
      return;
    }
    setError(null);
    try {
      await onScanStart(connectorId.trim());
      setConnectorId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex items-end gap-3">
      <div className="flex-1">
        <label htmlFor="connector-id" className="block text-xs text-zinc-400 mb-1">
          Connector ID
        </label>
        <input
          id="connector-id"
          type="text"
          value={connectorId}
          onChange={(e) => setConnectorId(e.target.value)}
          placeholder="e.g. hubspot, salesforce"
          disabled={loading}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={loading || !connectorId.trim()}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Scanning…' : 'Run Scan'}
      </button>
    </form>
  );
}
