'use client';

import { useState } from 'react';

type DsrRequest = {
  requestId: string;
  requesterEmail: string;
  requestType: 'deletion' | 'export' | 'rectification' | 'access';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  entityCount: number;
  notes?: string | null;
  submittedAt: string;
  completedAt?: string | null;
  deadlineAt: string;
};

type DsrQueueProps = {
  requests: DsrRequest[];
  onStatusChange?: (requestId: string, status: DsrRequest['status']) => Promise<void>;
};

const STATUS_COLORS: Record<DsrRequest['status'], { bg: string; color: string }> = {
  pending: { bg: '#fef9c3', color: '#854d0e' },
  in_progress: { bg: '#e0f2fe', color: '#0369a1' },
  completed: { bg: '#dcfce7', color: '#166534' },
  failed: { bg: '#fee2e2', color: '#991b1b' },
  cancelled: { bg: '#f3f4f6', color: '#6b7280' },
};

const TYPE_LABELS: Record<DsrRequest['requestType'], string> = {
  deletion: 'Data Deletion',
  export: 'Data Export',
  rectification: 'Rectification',
  access: 'Subject Access',
};

export function DsrQueue({ requests, onStatusChange }: DsrQueueProps) {
  const [updating, setUpdating] = useState<string | null>(null);

  async function handleStatusChange(requestId: string, newStatus: DsrRequest['status']) {
    if (!onStatusChange) return;
    setUpdating(requestId);
    try {
      await onStatusChange(requestId, newStatus);
    } finally {
      setUpdating(null);
    }
  }

  function daysLeft(deadlineAt: string) {
    return Math.ceil((new Date(deadlineAt).getTime() - Date.now()) / 86_400_000);
  }

  if (requests.length === 0) {
    return (
      <div style={{ fontFamily: 'sans-serif', color: '#9ca3af', fontSize: '0.875rem', padding: '1.5rem', textAlign: 'center', border: '1px dashed #e5e7eb', borderRadius: 6 }}>
        No pending data subject requests.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      {requests.map((req) => {
        const sc = STATUS_COLORS[req.status];
        const days = daysLeft(req.deadlineAt);
        const urgent = req.status === 'pending' && days <= 7;

        return (
          <div
            key={req.requestId}
            style={{
              border: `1px solid ${urgent ? '#fca5a5' : '#e5e7eb'}`,
              borderRadius: 6,
              padding: '0.75rem 1rem',
              background: urgent ? '#fff5f5' : '#fff',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#111827', fontSize: '0.875rem' }}>
                  {TYPE_LABELS[req.requestType]}
                </span>
                <span style={{ padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: sc.bg, color: sc.color }}>
                  {req.status.replace('_', ' ')}
                </span>
                {urgent && (
                  <span style={{ padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600, background: '#fee2e2', color: '#991b1b' }}>
                    Due in {days}d
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                {new Date(req.submittedAt).toLocaleDateString()}
              </span>
            </div>

            <div style={{ fontSize: '0.8125rem', color: '#374151', marginBottom: '0.35rem' }}>
              <strong>{req.requesterEmail}</strong> · {req.entityCount} entities · deadline {new Date(req.deadlineAt).toLocaleDateString()}
            </div>

            {req.notes && (
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.35rem', fontStyle: 'italic' }}>{req.notes}</div>
            )}

            {onStatusChange && req.status !== 'completed' && req.status !== 'cancelled' && (
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
                {req.status === 'pending' && (
                  <button
                    onClick={() => void handleStatusChange(req.requestId, 'in_progress')}
                    disabled={updating === req.requestId}
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
                  >
                    Start
                  </button>
                )}
                {(req.status === 'pending' || req.status === 'in_progress') && (
                  <button
                    onClick={() => void handleStatusChange(req.requestId, 'completed')}
                    disabled={updating === req.requestId}
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', border: '1px solid #bbf7d0', borderRadius: 4, background: '#dcfce7', color: '#166534', cursor: 'pointer' }}
                  >
                    Complete
                  </button>
                )}
                <button
                  onClick={() => void handleStatusChange(req.requestId, 'cancelled')}
                  disabled={updating === req.requestId}
                  style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', color: '#6b7280', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
