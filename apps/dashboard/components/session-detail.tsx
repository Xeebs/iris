'use client';

import { useState } from 'react';

type SessionFeedback = {
  helpful: boolean;
  notes: string | null;
  createdAt: string;
};

type FullSession = {
  sessionId: string;
  question: string;
  intent: { type?: string; confidence?: number };
  queryPlan: Record<string, unknown>;
  followUpQuestions: string[];
  isFavorite: boolean;
  createdAt: string;
  feedback: SessionFeedback | null;
};

type SessionDetailProps = {
  session: FullSession;
  onDeleteQuestion?: (sessionId: string, questionIndex: number) => void;
  onCopyQuery?: (query: string) => void;
};

export function SessionDetail({ session, onDeleteQuestion, onCopyQuery }: SessionDetailProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // clipboard not available
    }
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 600, color: '#111827' }}>
            {session.isFavorite && <span style={{ color: '#f59e0b', marginRight: '0.375rem' }}>★</span>}
            {session.question}
          </h3>
          <div style={{ fontSize: '0.8125rem', color: '#6b7280' }}>
            {session.intent.type && (
              <span style={{ marginRight: '0.75rem' }}>
                Intent: <strong>{session.intent.type}</strong>
                {session.intent.confidence && ` (${(session.intent.confidence * 100).toFixed(0)}%)`}
              </span>
            )}
            <span>{new Date(session.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <button
          onClick={() => { onCopyQuery?.(session.question); void copyToClipboard(session.question, 'question'); }}
          style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '0.25rem 0.5rem', background: '#fff', cursor: 'pointer', fontSize: '0.8125rem', color: '#6b7280' }}
        >
          {copiedKey === 'question' ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Query plan */}
      {Object.keys(session.queryPlan).length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.4rem', color: '#374151' }}>Query Plan</div>
          <pre style={{ margin: 0, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 4, padding: '0.5rem', fontSize: '0.8125rem', overflow: 'auto' }}>
            {JSON.stringify(session.queryPlan, null, 2)}
          </pre>
        </div>
      )}

      {/* Follow-up questions */}
      {session.followUpQuestions.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.4rem', color: '#374151' }}>Follow-up Suggestions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {session.followUpQuestions.map((q, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f9fafb', borderRadius: 5, padding: '0.3rem 0.6rem', fontSize: '0.875rem' }}>
                <span style={{ flex: 1, color: '#374151' }}>{q}</span>
                <button
                  onClick={() => void copyToClipboard(q, `q-${idx}`)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.8125rem', color: '#9ca3af' }}
                >
                  {copiedKey === `q-${idx}` ? '✓' : '⎘'}
                </button>
                {onDeleteQuestion && (
                  <button
                    onClick={() => onDeleteQuestion(session.sessionId, idx)}
                    style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.8125rem', color: '#dc2626' }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      {session.feedback && (
        <div style={{
          padding: '0.5rem 0.75rem', borderRadius: 5, fontSize: '0.875rem',
          background: session.feedback.helpful ? '#f0fdf4' : '#fef2f2',
          borderLeft: `3px solid ${session.feedback.helpful ? '#22c55e' : '#ef4444'}`,
        }}>
          <span style={{ fontWeight: 600, color: session.feedback.helpful ? '#15803d' : '#dc2626' }}>
            {session.feedback.helpful ? '👍 Helpful' : '👎 Not helpful'}
          </span>
          {session.feedback.notes && <span style={{ marginLeft: '0.5rem', color: '#6b7280' }}>— {session.feedback.notes}</span>}
        </div>
      )}
    </div>
  );
}
