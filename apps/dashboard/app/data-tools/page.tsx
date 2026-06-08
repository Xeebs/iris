'use client';

import React, { useState } from 'react';
import { ImportWizard } from '../../components/import-wizard.js';
import { ExportConfigurator } from '../../components/export-configurator.js';
import { JobHistoryTable } from '../../components/job-history-table.js';

type Tab = 'import' | 'export' | 'history';

export default function DataToolsPage() {
  const workspaceId = 'default'; // In production, derive from auth context
  const [activeTab, setActiveTab] = useState<Tab>('import');
  const [lastImport, setLastImport] = useState<{ jobId: string; inserted: number; skipped: number } | null>(null);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'import', label: 'Import Data' },
    { id: 'export', label: 'Export Data' },
    { id: 'history', label: 'Job History' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold mb-6">Data Tools</h1>

      <div className="border-b mb-6">
        <nav className="flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'import' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Upload a CSV or JSON file to import entities. Map columns to entity fields in the wizard.
          </p>
          {lastImport && (
            <div className="mb-4 p-3 bg-green-50 rounded text-sm text-green-800">
              Import complete — {lastImport.inserted.toLocaleString()} entities inserted
              {lastImport.skipped > 0 && `, ${lastImport.skipped} rows skipped`}.
              Job ID: <code className="text-xs">{lastImport.jobId}</code>
            </div>
          )}
          <ImportWizard
            workspaceId={workspaceId}
            onComplete={(result) => {
              setLastImport(result);
              setActiveTab('history');
            }}
          />
        </div>
      )}

      {activeTab === 'export' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Export entities from this workspace in CSV or JSON format.
          </p>
          <ExportConfigurator workspaceId={workspaceId} />
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <p className="text-sm text-gray-600 mb-4">
            Recent import and export jobs for this workspace.
          </p>
          <JobHistoryTable workspaceId={workspaceId} />
        </div>
      )}
    </div>
  );
}
