'use client';

import { useState, useRef } from 'react';

type NlQuerySession = {
  sessionId: string;
  question: string;
  intent: { type: string; confidence: number; entityTypes: string[] };
  queryPlan: { intentType: string; limit: number; explanation: string; aggregations: string[] };
  followUpQuestions: string[];
};

const INTENT_BADGES: Record<string, { label: string; color: string }> = {
  'entity-search': { label: 'Search', color: '#3b82f6' },
  'metric-lookup': { label: 'Metric', color: '#10b981' },
  'trend-analysis': { label: 'Trend', color: '#f59e0b' },
  comparison: { label: 'Compare', color: '#8b5cf6' },
  aggregation: { label: 'Aggregate', color: '#ec4899' },
};

const EXAMPLE_QUESTIONS = [
  'How many contacts do we have in total?',
  'Show all open deals this quarter',
  'Compare enterprise vs SMB conversion rates',
  'What is our MRR trend over the last 30 days?',
];

type Props = {
  onResult?: (session: NlQuerySession) => void;
};

export function QueryInput({ onResult }: Props) {
  const [question, setQuestion] = useState('');
  const [session, setSession] = useState<NlQuerySession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<'helpful' | 'unhelpful' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submitQuery(q = question) {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch('/api/v1/queries/natural-language', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json() as { data: NlQuerySession; error?: { message: string } };
      if (!res.ok) throw new Error(json.error?.message ?? 'Unknown error');
      setSession(json.data);
      onResult?.(json.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function sendFeedback(helpful: boolean) {
    if (!session) return;
    setFeedback(helpful ? 'helpful' : 'unhelpful');
    await fetch('/api/v1/queries/natural-language/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, helpful }),
    }).catch(() => { /* silent */ });
  }

  const badge = session ? INTENT_BADGES[session.intent.type] : null;

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 720 }}>
      {/* Search bar */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: 12,
        background: '#fff',
        border: '2px solid #e5e7eb',
        borderRadius: 12,
        marginBottom: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <span style={{ fontSize: 18, lineHeight: '36px', color: '#9ca3af' }}>🔍</span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask a business question (e.g. 'Which deals are at risk this quarter?')"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submitQuery()}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: 15,
            color: '#111827',
          }}
        />
        <button
          onClick={() => void submitQuery()}
          disabled={loading || !question.trim()}
          style={{
            padding: '8px 18px',
            background: loading ? '#9ca3af' : '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {/* Example questions */}
      {!session && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {EXAMPLE_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => { setQuestion(q); void submitQuery(q); }}
              style={{
                padding: '4px 10px',
                border: '1px solid #e5e7eb',
                borderRadius: 20,
                fontSize: 12,
                color: '#4b5563',
                background: '#f9fafb',
                cursor: 'pointer',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#dc2626', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Result card */}
      {session && (
        <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff' }}>
          {/* Intent badge + confidence */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            {badge && (
              <span style={{
                padding: '2px 10px',
                background: badge.color,
                color: '#fff',
                borderRadius: 12,
                fontSize: 12,
                fontWeight: 600,
              }}>
                {badge.label}
              </span>
            )}
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {Math.round(session.intent.confidence * 100)}% confidence
            </span>
            <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 8 }}>
              Entities: {session.intent.entityTypes.join(', ')}
            </span>
          </div>

          {/* Plan explanation */}
          <p style={{ fontSize: 14, color: '#374151', marginBottom: 12 }}>
            {session.queryPlan.explanation}
          </p>

          {session.queryPlan.aggregations.length > 0 && (
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              Aggregations: {session.queryPlan.aggregations.join(', ')}
            </div>
          )}

          {/* Follow-up questions */}
          {session.followUpQuestions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Follow-up questions:</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {session.followUpQuestions.map((q) => (
                  <button
                    key={q}
                    onClick={() => { setQuestion(q); void submitQuery(q); }}
                    style={{
                      padding: '4px 10px',
                      border: '1px solid #bfdbfe',
                      borderRadius: 16,
                      fontSize: 12,
                      color: '#2563eb',
                      background: '#eff6ff',
                      cursor: 'pointer',
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Feedback thumbs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #f3f4f6', paddingTop: 10, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>Was this helpful?</span>
            <button
              onClick={() => void sendFeedback(true)}
              disabled={feedback !== null}
              style={{
                padding: '3px 10px',
                border: `1px solid ${feedback === 'helpful' ? '#10b981' : '#d1d5db'}`,
                background: feedback === 'helpful' ? '#f0fdf4' : '#fff',
                borderRadius: 6,
                fontSize: 13,
                cursor: feedback ? 'default' : 'pointer',
              }}
            >
              👍
            </button>
            <button
              onClick={() => void sendFeedback(false)}
              disabled={feedback !== null}
              style={{
                padding: '3px 10px',
                border: `1px solid ${feedback === 'unhelpful' ? '#ef4444' : '#d1d5db'}`,
                background: feedback === 'unhelpful' ? '#fef2f2' : '#fff',
                borderRadius: 6,
                fontSize: 13,
                cursor: feedback ? 'default' : 'pointer',
              }}
            >
              👎
            </button>
            {feedback && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>Thanks for the feedback!</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
