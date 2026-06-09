'use client';

import React from 'react';

export type QualityIssue = {
  issueId: string;
  issueType: 'duplicates' | 'stale' | 'invalid' | 'missing_relationship';
  entityType: string;
  affectedCount: number;
  severity: 'low' | 'medium' | 'high';
  description: string | null;
  firstDetectedAt: string;
};

type Props = {
  issues: QualityIssue[];
  onApplyRemediation?: (issueId: string) => void;
};

const SEVERITY_STYLES: Record<QualityIssue['severity'], string> = {
  high: 'bg-red-100 text-red-700 border-red-200',
  medium: 'bg-orange-100 text-orange-700 border-orange-200',
  low: 'bg-yellow-50 text-yellow-700 border-yellow-200',
};

const ISSUE_ICONS: Record<QualityIssue['issueType'], string> = {
  duplicates: '🔁',
  stale: '🕐',
  invalid: '⚠️',
  missing_relationship: '🔗',
};

const ISSUE_LABELS: Record<QualityIssue['issueType'], string> = {
  duplicates: 'Duplicates',
  stale: 'Stale Data',
  invalid: 'Incomplete Records',
  missing_relationship: 'Missing Relationships',
};

export function IssuesList({ issues, onApplyRemediation }: Props) {
  if (issues.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No quality issues detected.
      </div>
    );
  }

  const grouped = issues.reduce<Record<QualityIssue['severity'], QualityIssue[]>>(
    (acc, issue) => {
      acc[issue.severity].push(issue);
      return acc;
    },
    { high: [], medium: [], low: [] },
  );

  return (
    <div className="space-y-4">
      {(['high', 'medium', 'low'] as const).map((severity) => {
        const sectionIssues = grouped[severity];
        if (sectionIssues.length === 0) return null;

        return (
          <div key={severity}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              {severity} severity ({sectionIssues.length})
            </h4>
            <div className="space-y-2">
              {sectionIssues.map((issue) => (
                <div
                  key={issue.issueId}
                  className={`flex items-center gap-4 p-4 border rounded-lg ${SEVERITY_STYLES[severity]}`}
                >
                  <span className="text-xl">{ISSUE_ICONS[issue.issueType]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{ISSUE_LABELS[issue.issueType]}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-white bg-opacity-60 rounded">
                        {issue.entityType}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 opacity-80">{issue.description ?? `Affects ${issue.affectedCount} entities`}</p>
                    <p className="text-xs opacity-60 mt-0.5">
                      Detected {new Date(issue.firstDetectedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold">{issue.affectedCount.toLocaleString()}</p>
                    <p className="text-xs opacity-70">affected</p>
                  </div>
                  {onApplyRemediation && (
                    <button
                      type="button"
                      onClick={() => onApplyRemediation(issue.issueId)}
                      className="shrink-0 px-3 py-1.5 text-xs font-medium bg-white bg-opacity-80 border border-current rounded hover:bg-opacity-100 transition-colors"
                    >
                      Fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
