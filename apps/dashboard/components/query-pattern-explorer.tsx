'use client';

type TemporalDefinition = { type: 'temporal'; hourOfDay: number; entityTypes: string[] };
type UserDefinition = { type: 'user'; userId: string; topEntityTypes: string[]; avgQueryInterval: number };
type EntityTypeDefinition = { type: 'entity_type'; entityType: string; peakHour: number; frequency: number };
type PatternDefinition = TemporalDefinition | UserDefinition | EntityTypeDefinition;

type QueryPattern = {
  patternType: 'temporal' | 'user' | 'entity_type';
  definition: PatternDefinition;
  confidenceScore: number;
  discoveredAt: string;
};

type Props = {
  patterns: QueryPattern[];
};

const TYPE_LABELS: Record<QueryPattern['patternType'], string> = {
  temporal: 'Temporal Pattern',
  user: 'User Pattern',
  entity_type: 'Entity Type Pattern',
};

const TYPE_COLORS: Record<QueryPattern['patternType'], string> = {
  temporal: 'bg-blue-100 text-blue-700',
  user: 'bg-purple-100 text-purple-700',
  entity_type: 'bg-green-100 text-green-700',
};

/**
 * Renders discovered query patterns with confidence scores and human-readable descriptions.
 */
export function QueryPatternExplorer({ patterns }: Props) {
  if (patterns.length === 0) {
    return (
      <div className="text-sm text-gray-400 text-center py-8 border border-dashed border-gray-200 rounded-lg">
        No patterns discovered yet. Click "Detect Patterns" to analyse recent query history.
      </div>
    );
  }

  const sorted = [...patterns].sort((a, b) => b.confidenceScore - a.confidenceScore);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h3 className="text-sm font-semibold text-gray-900">{patterns.length} Pattern(s) Discovered</h3>
        <div className="flex gap-2">
          {(['temporal', 'user', 'entity_type'] as const).map((t) => {
            const count = patterns.filter((p) => p.patternType === t).length;
            if (count === 0) return null;
            return (
              <span key={t} className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[t]}`}>
                {count} {t.replace('_', ' ')}
              </span>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map((pattern, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-4 bg-white">
            <div className="flex items-start justify-between">
              <div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[pattern.patternType]}`}>
                  {TYPE_LABELS[pattern.patternType]}
                </span>
                <p className="text-sm text-gray-700 mt-2">{describePattern(pattern)}</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <div className="text-lg font-bold text-gray-900">
                  {(pattern.confidenceScore * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-gray-400">confidence</div>
              </div>
            </div>
            <ConfidenceBar score={pattern.confidenceScore} />
            <div className="text-xs text-gray-400 mt-2">
              Discovered {new Date(pattern.discoveredAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function describePattern(pattern: QueryPattern): string {
  const def = pattern.definition;
  switch (def.type) {
    case 'temporal':
      return `High query volume at ${def.hourOfDay}:00${def.entityTypes.length > 0 ? `, often for ${def.entityTypes.join(', ')}` : ''}.`;
    case 'user':
      return `User ${def.userId} frequently queries ${def.topEntityTypes.join(', ')} every ~${Math.round(def.avgQueryInterval / 60_000)} min.`;
    case 'entity_type':
      return `"${def.entityType}" entities peak at ${def.peakHour}:00 (${def.frequency} queries in window).`;
  }
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-green-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-gray-300';
  return (
    <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
