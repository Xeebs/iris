'use client';

import React from 'react';

export type RemediationAction = {
  actionId: string;
  issueId: string;
  actionType: string;
  description: string;
  estimatedImpact: string | null;
  status: 'pending' | 'approved' | 'applied';
  appliedAt: string | null;
  createdAt: string;
};

type Props = {
  actions: RemediationAction[];
  onApprove?: (actionId: string) => void;
};

const STATUS_STYLES: Record<RemediationAction['status'], string> = {
  pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  applied: 'bg-green-50 text-green-700 border-green-200',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  run_dedup: 'Deduplication',
  trigger_sync: 'Data Refresh',
  enrich_entities: 'Enrichment',
  link_entities: 'Relationship Linking',
};

export function RemediationStatus({ actions, onApprove }: Props) {
  if (actions.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No remediation actions tracked.
      </div>
    );
  }

  const pending = actions.filter((a) => a.status === 'pending');
  const inProgress = actions.filter((a) => a.status === 'approved');
  const completed = actions.filter((a) => a.status === 'applied');

  const sections: Array<{ title: string; items: RemediationAction[] }> = [
    { title: `Pending (${pending.length})`, items: pending },
    { title: `In Progress (${inProgress.length})`, items: inProgress },
    { title: `Completed (${completed.length})`, items: completed },
  ];

  return (
    <div className="space-y-6">
      {sections.filter((s) => s.items.length > 0).map(({ title, items }) => (
        <div key={title}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{title}</h4>
          <div className="space-y-2">
            {items.map((action) => (
              <div
                key={action.actionId}
                className={`flex items-start gap-4 p-4 border rounded-lg ${STATUS_STYLES[action.status]}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {ACTION_TYPE_LABELS[action.actionType] ?? action.actionType}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border ${STATUS_STYLES[action.status]}`}>
                      {action.status}
                    </span>
                  </div>
                  <p className="text-xs mt-1 opacity-80">{action.description}</p>
                  {action.estimatedImpact && (
                    <p className="text-xs mt-0.5 opacity-60 italic">{action.estimatedImpact}</p>
                  )}
                  <p className="text-xs opacity-50 mt-1">
                    {action.status === 'applied' && action.appliedAt
                      ? `Applied ${new Date(action.appliedAt).toLocaleString()}`
                      : `Created ${new Date(action.createdAt).toLocaleDateString()}`}
                  </p>
                </div>

                {action.status === 'pending' && onApprove && (
                  <button
                    type="button"
                    onClick={() => onApprove(action.actionId)}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium bg-white bg-opacity-80 border rounded hover:bg-opacity-100 transition-colors"
                  >
                    Approve
                  </button>
                )}

                {action.status === 'applied' && (
                  <span className="shrink-0 text-green-500 text-xl">✓</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
