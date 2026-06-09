'use client';

import { useEffect, useState } from 'react';
import { SessionDetail } from '../../../../components/session-detail.js';
import { LearningInsights } from '../../../../components/learning-insights.js';

type Session = {
  sessionId: string;
  question: string;
  intent: { type?: string; confidence?: number };
  queryPlan: Record<string, unknown>;
  followUpQuestions: string[];
  isFavorite: boolean;
  createdAt: string;
  feedback: { helpful: boolean; notes: string | null; createdAt: string } | null;
};

type Tab = 'sessions' | 'favorites' | 'learning';

export default function QuerySessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('sessions');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void fetchSessions();
  }, []);

  async function fetchSessions() {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/nl-queries/sessions', { headers: { 'x-workspace-id': 'current' } });
      if (res.ok) {
        const body = (await res.json()) as { data: Session[] };
        setSessions(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function selectSession(sessionId: string) {
    const res = await fetch(`/api/v1/nl-queries/sessions/${sessionId}`, { headers: { 'x-workspace-id': 'current' } });
    if (res.ok) {
      const body = (await res.json()) as { data: Session };
      setSelectedSession(body.data);
    }
  }

  async function favoriteSession(sessionId: string) {
    await fetch(`/api/v1/nl-queries/sessions/${sessionId}/favorite`, {
      method: 'POST',
      headers: { 'x-workspace-id': 'current' },
    });
    await fetchSessions();
  }

  async function deleteQuestion(sessionId: string, questionIndex: number) {
    await fetch(`/api/v1/nl-queries/sessions/${sessionId}/question/${questionIndex}`, {
      method: 'DELETE',
      headers: { 'x-workspace-id': 'current' },
    });
    if (selectedSession?.sessionId === sessionId) {
      await selectSession(sessionId);
    }
  }

  const filteredSessions = sessions.filter((s) =>
    !filter || s.question.toLowerCase().includes(filter.toLowerCase())
  );
  const favoriteSessions = sessions.filter((s) => s.isFavorite);

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 1100 }}>
      <h1 style={{ margin: '0 0 1.25rem', fontSize: '1.25rem', fontWeight: 700 }}>NL Query Sessions</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '2px solid #e5e7eb' }}>
        {([
          ['sessions', `Sessions (${sessions.length})`],
          ['favorites', `Favorites (${favoriteSessions.length})`],
          ['learning', 'Learning Dashboard'],
        ] as [Tab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1rem', border: 'none', background: 'transparent', cursor: 'pointer',
              borderBottom: activeTab === tab ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeTab === tab ? '#3b82f6' : '#6b7280', fontWeight: activeTab === tab ? 600 : 400,
              fontSize: '0.875rem', marginBottom: -2,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : (
        <>
          {(activeTab === 'sessions' || activeTab === 'favorites') && (
            <div style={{ display: 'grid', gridTemplateColumns: selectedSession ? '1fr 1fr' : '1fr', gap: '1rem' }}>
              <div>
                <input
                  type="text"
                  placeholder="Filter questions…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{ width: '100%', padding: '0.35rem 0.6rem', border: '1px solid #d1d5db', borderRadius: 5, fontSize: '0.875rem', marginBottom: '0.75rem', boxSizing: 'border-box' }}
                />

                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: 600 }}>Question</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: 600 }}>Intent</th>
                      <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: 600 }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeTab === 'favorites' ? favoriteSessions : filteredSessions).map((s) => (
                      <tr
                        key={s.sessionId}
                        onClick={() => void selectSession(s.sessionId)}
                        style={{
                          borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                          background: selectedSession?.sessionId === s.sessionId ? '#eff6ff' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '0.4rem 0.75rem', color: '#111827', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.isFavorite && <span style={{ color: '#f59e0b', marginRight: '0.3rem' }}>★</span>}
                          {s.question}
                        </td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#6b7280' }}>{s.intent.type ?? '—'}</td>
                        <td style={{ padding: '0.4rem 0.75rem', color: '#9ca3af', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          {new Date(s.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredSessions.length === 0 && (
                  <p style={{ color: '#9ca3af', padding: '1rem', textAlign: 'center' }}>No sessions found.</p>
                )}
              </div>

              {selectedSession && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Session Detail</span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {!selectedSession.isFavorite && (
                        <button
                          onClick={() => void favoriteSession(selectedSession.sessionId)}
                          style={{ border: '1px solid #d1d5db', borderRadius: 4, padding: '0.25rem 0.6rem', background: '#fff', cursor: 'pointer', fontSize: '0.8125rem' }}
                        >
                          ☆ Bookmark
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedSession(null)}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1rem', color: '#9ca3af' }}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <SessionDetail
                    session={selectedSession}
                    onDeleteQuestion={(sid, idx) => void deleteQuestion(sid, idx)}
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'learning' && (
            <LearningInsights sessions={sessions} />
          )}
        </>
      )}
    </div>
  );
}
