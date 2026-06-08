'use client';

import { useState } from 'react';
import VersionTimeline from '@/components/version-timeline';
import ContextDiffViewer from '@/components/context-diff-viewer';

type Tab = 'versions' | 'query' | 'diff';

const MOCK_VERSIONS = [
  { snapshotId: 'snap-3', snapshotKey: 'post-june-sync', capturedAt: new Date('2026-06-08T10:00:00Z'), entityCount: 2340, dataSizeBytes: 850000 },
  { snapshotId: 'snap-2', snapshotKey: 'pre-june-sync', capturedAt: new Date('2026-06-07T09:00:00Z'), entityCount: 2280, dataSizeBytes: 820000 },
  { snapshotId: 'snap-1', snapshotKey: 'initial-import', capturedAt: new Date('2026-06-01T08:00:00Z'), entityCount: 1850, dataSizeBytes: 650000 },
];

const MOCK_DIFF = {
  fromVersionId: 'snap-2',
  toVersionId: 'snap-3',
  changedEntityIds: ['hubspot:contact:1234', 'hubspot:contact:5678', 'salesforce:deal:9012', 'hubspot:company:3456', 'slack:channel:7890'],
  changeTypes: ['created', 'updated', 'created', 'updated', 'deleted'] as ('created' | 'updated' | 'deleted')[],
  diffSummary: { created: 2, updated: 2, deleted: 1, totalChanges: 5 },
};

export default function ContextVersioningPage() {
  const [tab, setTab] = useState<Tab>('versions');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('snap-3');
  const [compareVersionId, setCompareVersionId] = useState<string>('snap-2');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyDate, setHistoryDate] = useState('2026-06-07T00:00:00');
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Context Versioning</h1>
          <p className="mt-1 text-sm text-gray-500">
            Query context as it existed in the past, compare versions, and roll back when needed.
          </p>
        </div>
        <button className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          Capture Snapshot
        </button>
      </div>

      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {(['versions', 'query', 'diff'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {t === 'versions' ? 'Version History' : t === 'query' ? 'Time-Travel Query' : 'Compare Versions'}
          </button>
        ))}
      </div>

      {tab === 'versions' && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-1">
            <h2 className="mb-3 text-sm font-semibold text-gray-700">Snapshots</h2>
            <VersionTimeline
              versions={MOCK_VERSIONS}
              selectedId={selectedVersionId}
              onSelect={setSelectedVersionId}
            />
          </div>
          <div className="col-span-2">
            {selectedVersionId && (
              <div className="rounded-lg border border-gray-200 bg-white p-5">
                {(() => {
                  const v = MOCK_VERSIONS.find(x => x.snapshotId === selectedVersionId);
                  if (!v) return null;
                  return (
                    <>
                      <h3 className="mb-4 text-sm font-semibold text-gray-900">{v.snapshotKey}</h3>
                      <div className="grid grid-cols-2 gap-4">
                        {[
                          { label: 'Captured', value: v.capturedAt.toLocaleString() },
                          { label: 'Entities', value: v.entityCount.toLocaleString() },
                          { label: 'Data size', value: `${(v.dataSizeBytes / 1024).toFixed(0)} KB` },
                          { label: 'Snapshot ID', value: v.snapshotId },
                        ].map(stat => (
                          <div key={stat.label}>
                            <p className="text-xs text-gray-500">{stat.label}</p>
                            <p className="mt-0.5 text-sm font-medium text-gray-900">{stat.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => { setCompareVersionId(selectedVersionId); setTab('diff'); }}
                          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Compare
                        </button>
                        <button
                          onClick={() => setShowRollbackConfirm(true)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Roll Back
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'query' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Query Historical Context</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700">Query</label>
                <input
                  value={historyQuery}
                  onChange={e => setHistoryQuery(e.target.value)}
                  placeholder="e.g. show all deals from Q1"
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700">As of date</label>
                <input
                  type="datetime-local"
                  value={historyDate}
                  onChange={e => setHistoryDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <button className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Run Historical Query
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 text-center">
            Results will appear here after running the query.
          </div>
        </div>
      )}

      {tab === 'diff' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700">From version</label>
              <select
                value={compareVersionId}
                onChange={e => setCompareVersionId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
              >
                {MOCK_VERSIONS.map(v => <option key={v.snapshotId} value={v.snapshotId}>{v.snapshotKey}</option>)}
              </select>
            </div>
            <span className="text-gray-400 mt-4">→</span>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700">To version</label>
              <select
                value={selectedVersionId}
                onChange={e => setSelectedVersionId(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm"
              >
                {MOCK_VERSIONS.map(v => <option key={v.snapshotId} value={v.snapshotId}>{v.snapshotKey}</option>)}
              </select>
            </div>
          </div>

          <ContextDiffViewer diff={MOCK_DIFF} />
        </div>
      )}

      {showRollbackConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="rounded-lg bg-white p-6 shadow-xl max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-gray-900">Confirm Rollback</h3>
            <p className="mt-2 text-sm text-gray-600">
              This will revert the workspace index to the selected snapshot. This action cannot be undone.
            </p>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => setShowRollbackConfirm(false)}
                className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={() => setShowRollbackConfirm(false)}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Confirm Rollback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
