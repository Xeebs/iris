'use client';

import { useState, useEffect } from 'react';

type DedupDecision = 'merge' | 'keep_separate' | 'ignore';
type CandidateStatus = 'pending' | 'reviewed' | 'merged' | 'undone';

type DecisionRecord = {
  id: string;
  sourceEntityId: string;
  candidateDuplicateId: string;
  similarityScore: number;
  status: CandidateStatus;
  decision: DedupDecision | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

type Props = {
  workspaceId: string;
};

const DECISION_LABEL: Record<DedupDecision, string> = {
  merge: 'Merged',
  keep_separate: 'Kept separate',
  ignore: 'Ignored',
};

const DECISION_STYLE: Record<DedupDecision, { background: string; color: string }> = {
  merge: { background: '#dcfce7', color: '#15803d' },
  keep_separate: { background: '#f3f4f6', color: '#374151' },
  ignore: { background: '#fef3c7', color: '#92400e' },
};

/**
 * Audit trail of all reviewed dedup candidates for a workspace.
 *
 * @param workspaceId - Workspace scope
 */
export function DedupDecisionHistory({ workspaceId }: Props) {
  const [records, setRecords] = useState<DecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoTarget, setUndoTarget] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/dedup/candidates?status=reviewed&limit=100`, {
      headers: { 'x-workspace-id': workspaceId },
    })
      .then(async (r) => {
        if (!r.ok) return;
        const json = await r.json() as { data: DecisionRecord[] };
        setRecords(json.data);
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  async function handleUndo(record: DecisionRecord) {
    setUndoError(null);
    setUndoTarget(record.id);
    try {
      const res = await fetch(
        `/api/v1/dedup/merge/${encodeURIComponent(record.sourceEntityId)}/${encodeURIComponent(record.candidateDuplicateId)}/undo`,
        { method: 'POST', headers: { 'x-workspace-id': workspaceId } },
      );
      if (!res.ok) {
        const body = await res.json() as { error: { message: string } };
        throw new Error(body.error.message);
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
    } catch (e: unknown) {
      setUndoError((e as Error).message);
    } finally {
      setUndoTarget(null);
    }
  }

  if (loading) return <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>Loading history…</div>;
  if (records.length === 0) return (
    <div style={{ padding: 16, color: '#6b7280', fontSize: 13 }}>
      No reviewed candidates yet — decisions will appear here after manual review.
    </div>
  );

  return (
    <div style={{ fontSize: 13 }}>
      {undoError && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fee2e2', color: '#b91c1c', borderRadius: 6 }}>
          Undo failed: {undoError}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Entity A</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Entity B</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Score</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Decision</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>Decided by</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280', fontWeight: 500 }}>When</th>
            <th style={{ padding: '6px 8px' }}></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const decStyle = r.decision ? (DECISION_STYLE[r.decision] ?? DECISION_STYLE['ignore']) : { background: '#f3f4f6', color: '#6b7280' };
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '5px 8px' }}>
                  <code style={{ fontSize: 11 }}>{r.sourceEntityId.slice(0, 24)}{r.sourceEntityId.length > 24 ? '…' : ''}</code>
                </td>
                <td style={{ padding: '5px 8px' }}>
                  <code style={{ fontSize: 11 }}>{r.candidateDuplicateId.slice(0, 24)}{r.candidateDuplicateId.length > 24 ? '…' : ''}</code>
                </td>
                <td style={{ padding: '5px 8px' }}>{Math.round(r.similarityScore * 100)}%</td>
                <td style={{ padding: '5px 8px' }}>
                  {r.decision && (
                    <span style={{ ...decStyle, padding: '2px 8px', borderRadius: 9999, fontWeight: 600 }}>
                      {DECISION_LABEL[r.decision]}
                    </span>
                  )}
                </td>
                <td style={{ padding: '5px 8px', color: '#6b7280' }}>{r.decidedBy ?? '—'}</td>
                <td style={{ padding: '5px 8px', color: '#6b7280' }}>
                  {r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : '—'}
                </td>
                <td style={{ padding: '5px 8px' }}>
                  {r.decision === 'merge' && (
                    <button
                      onClick={() => void handleUndo(r)}
                      disabled={undoTarget === r.id}
                      style={{
                        padding: '3px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: 4,
                        background: '#fff',
                        cursor: 'pointer',
                        fontSize: 11,
                        color: '#6b7280',
                      }}
                    >
                      {undoTarget === r.id ? '…' : 'Undo'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
