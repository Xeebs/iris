'use client';

import { useState } from 'react';
import { ImportWizard } from '../../../components/import-wizard';
import { ExportBuilder } from '../../../components/export-builder';

type Tab = 'import' | 'export';

export default function ImportExportPage() {
  const [tab, setTab] = useState<Tab>('import');

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import / Export Entities</h1>
        <p className="text-sm text-gray-500 mt-1">
          Bulk import entities from CSV or JSON, or export filtered entity sets for backup or migration.
        </p>
      </div>

      <div className="flex border-b border-gray-200">
        {(['import', 'export'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === 'import' && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Upload a JSON array or CSV file to bulk-insert entities into the workspace. Records are
              upserted by ID — existing entities are updated, new ones are created.
            </p>
            <ImportWizard />
          </div>
        )}

        {tab === 'export' && (
          <div className="space-y-2">
            <p className="text-sm text-gray-600">
              Export entities to JSON or CSV. Optionally filter by entity type or last-modified date.
              The download will start automatically.
            </p>
            <ExportBuilder />
          </div>
        )}
      </div>
    </div>
  );
}
