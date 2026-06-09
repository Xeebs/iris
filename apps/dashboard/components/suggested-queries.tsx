'use client';

type Suggestion = {
  question: string;
  intentType: string;
  description: string;
};

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { question: 'How many contacts were created this week?', intentType: 'aggregation', description: 'Count new contacts' },
  { question: 'Show all open deals over $50K', intentType: 'entity-search', description: 'High-value pipeline' },
  { question: 'What is our MRR trend over the last 3 months?', intentType: 'trend-analysis', description: 'Revenue trend' },
  { question: 'Compare win rates by sales rep', intentType: 'comparison', description: 'Team performance' },
  { question: 'Which companies have the highest deal value?', intentType: 'metric-lookup', description: 'Top accounts' },
  { question: 'List contacts with no activity in 30 days', intentType: 'entity-search', description: 'At-risk contacts' },
];

const INTENT_COLORS: Record<string, string> = {
  'entity-search': '#3b82f6',
  'metric-lookup': '#10b981',
  'trend-analysis': '#f59e0b',
  comparison: '#8b5cf6',
  aggregation: '#ec4899',
};

type Props = {
  suggestions?: Suggestion[];
  onSelect: (question: string) => void;
  title?: string;
};

export function SuggestedQueries({ suggestions = DEFAULT_SUGGESTIONS, onSelect, title = 'Suggested Queries' }: Props) {
  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 12 }}>{title}</div>

      {/* Horizontal scroll carousel */}
      <div style={{
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        paddingBottom: 8,
        scrollbarWidth: 'thin',
      }}>
        {suggestions.map((s) => (
          <button
            key={s.question}
            onClick={() => onSelect(s.question)}
            style={{
              flexShrink: 0,
              width: 200,
              padding: '10px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              background: '#fff',
              textAlign: 'left',
              cursor: 'pointer',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = INTENT_COLORS[s.intentType] ?? '#3b82f6';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb';
              (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
            }}
          >
            <div style={{
              display: 'inline-block',
              padding: '1px 6px',
              background: INTENT_COLORS[s.intentType] ?? '#3b82f6',
              color: '#fff',
              borderRadius: 8,
              fontSize: 10,
              fontWeight: 600,
              marginBottom: 6,
            }}>
              {s.intentType.replace('-', ' ')}
            </div>
            <div style={{ fontSize: 12, color: '#111827', fontWeight: 500, marginBottom: 4, lineHeight: 1.4 }}>
              {s.question}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
