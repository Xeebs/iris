'use client';

type Session = {
  question: string;
  intent: { type?: string; confidence?: number };
};

type LearningInsightsProps = {
  sessions: Session[];
  lowQualityThreshold?: number;
};

type WordFreq = { word: string; count: number };
type IntentPoint = { intentType: string; confidence: number; index: number };

function buildWordFrequencies(sessions: Session[]): WordFreq[] {
  const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'is', 'are', 'was', 'were', 'me', 'my', 'all', 'what', 'how', 'show', 'get', 'find']);
  const freq: Record<string, number> = {};
  for (const s of sessions) {
    for (const word of s.question.toLowerCase().split(/\s+/)) {
      const cleaned = word.replace(/[^a-z]/g, '');
      if (cleaned.length > 2 && !stopWords.has(cleaned)) {
        freq[cleaned] = (freq[cleaned] ?? 0) + 1;
      }
    }
  }
  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

export function LearningInsights({ sessions, lowQualityThreshold = 0.65 }: LearningInsightsProps) {
  const wordFreqs = buildWordFrequencies(sessions);
  const maxFreq = wordFreqs[0]?.count ?? 1;

  const intentPoints: IntentPoint[] = sessions
    .filter((s) => s.intent.type && s.intent.confidence !== undefined)
    .map((s, idx) => ({
      intentType: s.intent.type!,
      confidence: s.intent.confidence!,
      index: idx,
    }));

  const lowQualitySessions = sessions.filter(
    (s) => s.intent.confidence !== undefined && s.intent.confidence < lowQualityThreshold
  );

  if (sessions.length === 0) {
    return <p style={{ color: '#9ca3af', fontSize: '0.875rem' }}>No session data for insights yet.</p>;
  }

  const intentTypes = Array.from(new Set(intentPoints.map((p) => p.intentType)));
  const intentColors: Record<string, string> = {};
  const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  intentTypes.forEach((t, i) => { intentColors[t] = palette[i % palette.length]!; });

  return (
    <div style={{ fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Word cloud */}
      <div>
        <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
          Trending Query Terms
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', lineHeight: '1.6' }}>
          {wordFreqs.map(({ word, count }) => {
            const scale = 0.75 + (count / maxFreq) * 1.25;
            return (
              <span key={word} style={{
                fontSize: `${scale}rem`,
                color: `hsl(${(count / maxFreq) * 220}, 70%, 40%)`,
                fontWeight: count > maxFreq * 0.5 ? 700 : 400,
              }}>
                {word}
              </span>
            );
          })}
        </div>
      </div>

      {/* Confidence scatter */}
      {intentPoints.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#374151' }}>
            Intent Confidence Distribution
          </h3>
          <div style={{ position: 'relative', height: 120, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden', padding: '0.5rem' }}>
            {intentPoints.map((p) => (
              <div
                key={`${p.index}-${p.intentType}`}
                title={`${p.intentType}: ${(p.confidence * 100).toFixed(0)}%`}
                style={{
                  position: 'absolute',
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: intentColors[p.intentType] ?? '#6b7280',
                  left: `${(p.index / sessions.length) * 95}%`,
                  top: `${(1 - p.confidence) * 85}%`,
                }}
              />
            ))}
            {/* Threshold line */}
            <div style={{
              position: 'absolute',
              left: 0, right: 0,
              top: `${(1 - lowQualityThreshold) * 85}%`,
              borderTop: '1px dashed #ef4444',
              opacity: 0.5,
            }} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            {intentTypes.map((t) => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8125rem', color: '#374151' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: intentColors[t], display: 'inline-block' }} />
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Low quality flags */}
      {lowQualitySessions.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: '#dc2626' }}>
            Low Confidence Sessions ({lowQualitySessions.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {lowQualitySessions.slice(0, 10).map((s, idx) => (
              <div key={idx} style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 5, padding: '0.4rem 0.75rem', fontSize: '0.875rem' }}>
                <div style={{ color: '#111827' }}>{s.question}</div>
                <div style={{ color: '#dc2626', fontSize: '0.8125rem', marginTop: 2 }}>
                  Confidence: {s.intent.confidence !== undefined ? `${(s.intent.confidence * 100).toFixed(0)}%` : '?'} — consider refining the question
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
