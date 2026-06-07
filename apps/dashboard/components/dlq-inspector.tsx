'use client';

import { useState } from 'react';

export type DlqEntry = {
  id: string;
  jobId: string;
  connectorInstanceId: string | null;
  workspaceId: string;
  errorMessage: string;
  errorStack: string | null;
  attemptCount: number;
  jobData: { connectorInstanceId: string; workspaceId: string; triggeredAt: string };
  createdAt: string;
  retriedAt: string | null;
  retriedBy: string | null;
};

type Props = {
  entries: DlqEntry[];
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  onRetry: (dlqId: string) => Promise<void>;
};

export function DlqInspector({ entries, hasMore, loading, onLoadMore, onRetry }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRetry(id: string) {
    setRetrying((prev) => new Set(prev).add(id));
    try {
      await onRetry(id);
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (entries.length === 0 && !loading) {
    return <p style={{ color: '#6b7280', padding: '1rem 0' }}>No dead letter queue entries.</p>;
  }

  return (
    <div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>Connector</th>
            <th style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>Error</th>
            <th style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>Attempts</th>
            <th style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>Failed At</th>
            <th style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>Status</th>
            <th style={{ padding: '0.5rem 0.75rem', color: '#374151' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isExpanded = expanded.has(entry.id);
            const isRetrying = retrying.has(entry.id);
            const alreadyRetried = entry.retriedAt != null;
            const rowBg = alreadyRetried ? '#f0fdf4' : '#fff7ed';

            return (
              <>
                <tr
                  key={entry.id}
                  style={{ borderBottom: '1px solid #e5e7eb', backgroundColor: rowBg, cursor: 'pointer' }}
                  onClick={() => toggleExpand(entry.id)}
                >
                  <td style={{ padding: '0.625rem 0.75rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {entry.connectorInstanceId
                      ? entry.connectorInstanceId.slice(0, 8) + '…'
                      : '—'}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: '#dc2626', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.errorMessage}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', textAlign: 'center' }}>
                    <span style={{ background: '#fee2e2', color: '#b91c1c', borderRadius: '9999px', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 600 }}>
                      {entry.attemptCount}
                    </span>
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem', color: '#6b7280', fontSize: '0.8rem' }}>
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem' }}>
                    {alreadyRetried ? (
                      <span style={{ color: '#16a34a', fontSize: '0.8rem' }}>
                        Retried {entry.retriedAt ? new Date(entry.retriedAt).toLocaleDateString() : ''}
                      </span>
                    ) : (
                      <span style={{ color: '#b45309', fontSize: '0.8rem' }}>Pending</span>
                    )}
                  </td>
                  <td style={{ padding: '0.625rem 0.75rem' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      disabled={alreadyRetried || isRetrying}
                      onClick={() => handleRetry(entry.id)}
                      style={{
                        padding: '0.25rem 0.75rem',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: alreadyRetried ? '#d1d5db' : '#3b82f6',
                        background: alreadyRetried ? '#f3f4f6' : '#eff6ff',
                        color: alreadyRetried ? '#9ca3af' : '#2563eb',
                        cursor: alreadyRetried ? 'not-allowed' : 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                      }}
                    >
                      {isRetrying ? 'Retrying…' : alreadyRetried ? 'Done' : 'Retry'}
                    </button>
                  </td>
                </tr>
                {isExpanded && (
                  <tr key={`${entry.id}-detail`} style={{ background: '#f9fafb' }}>
                    <td colSpan={6} style={{ padding: '0.75rem 1rem' }}>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.8rem' }}>Job ID:</strong>{' '}
                        <code style={{ fontSize: '0.8rem' }}>{entry.jobId}</code>
                      </div>
                      <div style={{ marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '0.8rem' }}>Triggered At:</strong>{' '}
                        <span style={{ fontSize: '0.8rem' }}>{new Date(entry.jobData.triggeredAt).toLocaleString()}</span>
                      </div>
                      {entry.errorStack && (
                        <div>
                          <strong style={{ fontSize: '0.8rem' }}>Stack Trace:</strong>
                          <pre style={{
                            marginTop: '0.25rem',
                            padding: '0.5rem',
                            background: '#1f2937',
                            color: '#f9fafb',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            overflowX: 'auto',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            maxHeight: '200px',
                            overflowY: 'auto',
                          }}>
                            {entry.errorStack}
                          </pre>
                        </div>
                      )}
                      {entry.retriedBy && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#16a34a' }}>
                          Retried by <strong>{entry.retriedBy}</strong> on {entry.retriedAt ? new Date(entry.retriedAt).toLocaleString() : ''}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>

      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button
            onClick={onLoadMore}
            disabled={loading}
            style={{ padding: '0.5rem 1.5rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '0.875rem' }}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
