'use client';

import { useState } from 'react';

export interface GlossaryTermSummary {
  id: string;
  term: string;
  definition: string;
  status: 'pending' | 'approved' | 'rejected';
  usageCount: number;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface GlossaryCollaboratorProps {
  workspaceId: string;
  terms: GlossaryTermSummary[];
  /** Called when user approves a term. Returning false leaves the term in pending state. */
  onApprove?: (term: string, approvedBy: string) => Promise<boolean>;
}

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-green-50 text-green-700',
  pending: 'bg-yellow-50 text-yellow-700',
  rejected: 'bg-red-50 text-red-700',
};

/**
 * Glossary collaboration panel showing pending terms, approval queue, and usage analytics.
 *
 * @param workspaceId - Current workspace
 * @param terms       - Glossary terms to display
 * @param onApprove   - Callback invoked when user approves a pending term
 */
export function GlossaryCollaborator({
  workspaceId,
  terms,
  onApprove,
}: GlossaryCollaboratorProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'usage'>('pending');
  const [approving, setApproving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = terms.filter(t => t.status === 'pending');
  const approved = terms.filter(t => t.status === 'approved');
  const byUsage = [...terms].sort((a, b) => b.usageCount - a.usageCount);

  async function handleApprove(term: string) {
    setError(null);
    setApproving(term);
    try {
      const ok = await onApprove?.(term, 'dashboard-user');
      if (ok === false) setError(`Failed to approve "${term}"`);
    } catch {
      setError(`Failed to approve "${term}"`);
    } finally {
      setApproving(null);
    }
  }

  const tabs: { id: 'pending' | 'approved' | 'usage'; label: string; count?: number }[] = [
    { id: 'pending', label: 'Approval Queue', count: pending.length },
    { id: 'approved', label: 'Approved Terms', count: approved.length },
    { id: 'usage', label: 'Usage Analytics' },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">Glossary Collaboration</h2>
        <p className="mt-0.5 text-sm text-gray-500">Manage term approvals and track usage across your workspace.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-5">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`mr-6 flex items-center gap-1.5 border-b-2 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        {error !== null && (
          <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>
        )}

        {/* Pending approval queue */}
        {activeTab === 'pending' && (
          <div className="space-y-3">
            {pending.length === 0 ? (
              <p className="text-sm text-gray-500">No terms awaiting approval.</p>
            ) : (
              pending.map(term => (
                <div key={term.id} className="flex items-start justify-between rounded-md border border-yellow-100 bg-yellow-50 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">{term.term}</p>
                    <p className="mt-0.5 text-sm text-gray-600">{term.definition}</p>
                  </div>
                  <button
                    onClick={() => handleApprove(term.term)}
                    disabled={approving === term.term}
                    className="ml-4 flex-shrink-0 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {approving === term.term ? 'Approving…' : 'Approve'}
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Approved terms list */}
        {activeTab === 'approved' && (
          <div className="space-y-2">
            {approved.length === 0 ? (
              <p className="text-sm text-gray-500">No approved terms yet.</p>
            ) : (
              approved.map(term => (
                <div key={term.id} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2">
                  <div>
                    <span className="font-medium text-gray-900">{term.term}</span>
                    <span className="ml-2 text-sm text-gray-500">{term.definition}</span>
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[term.status]}`}>
                    {term.status}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Usage analytics */}
        {activeTab === 'usage' && (
          <div className="space-y-2">
            {byUsage.length === 0 ? (
              <p className="text-sm text-gray-500">No terms indexed yet.</p>
            ) : (
              byUsage.map(term => (
                <div key={term.id} className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">{term.term}</span>
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.min(100, (term.usageCount / (byUsage[0]?.usageCount || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs text-gray-500">{term.usageCount}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
