'use client';

import { useState } from 'react';
import { QueryInput } from '@/components/query-input';
import { SuggestedQueries } from '@/components/suggested-queries';

type NlQuerySession = {
  sessionId: string;
  question: string;
  intent: { type: string; confidence: number; entityTypes: string[] };
  queryPlan: { intentType: string; limit: number; explanation: string };
  followUpQuestions: string[];
};

export default function NaturalLanguageSearchPage() {
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [recentSessions, setRecentSessions] = useState<NlQuerySession[]>([]);

  function handleResult(session: NlQuerySession) {
    setRecentSessions((prev) => [session, ...prev].slice(0, 5));
  }

  function handleSuggestionSelect(question: string) {
    setCurrentQuestion(question);
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto', padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, marginBottom: 4 }}>Natural Language Search</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
          Ask any business question in plain English. Iris will classify your intent and generate an optimized context query.
        </p>
      </div>

      <div style={{ marginBottom: 24 }}>
        <QueryInput
          onResult={handleResult}
          key={currentQuestion}
        />
      </div>

      <div style={{ marginBottom: 32 }}>
        <SuggestedQueries
          onSelect={handleSuggestionSelect}
          title="Try these questions"
        />
      </div>

      {/* Recent queries */}
      {recentSessions.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 12 }}>Recent Queries</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentSessions.map((s) => (
              <div
                key={s.sessionId}
                style={{
                  padding: '10px 14px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  background: '#fafafa',
                }}
                onClick={() => handleSuggestionSelect(s.question)}
              >
                <span style={{
                  padding: '1px 8px',
                  background: '#f3f4f6',
                  borderRadius: 8,
                  fontSize: 11,
                  color: '#6b7280',
                  fontWeight: 600,
                }}>
                  {s.intent.type}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: '#111827' }}>{s.question}</span>
                <span style={{ fontSize: 11, color: '#9ca3af' }}>
                  {s.intent.entityTypes.join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
