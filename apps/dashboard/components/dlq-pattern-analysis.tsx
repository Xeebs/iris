'use client';

type DlqPattern = {
  pattern: string;
  count: number;
  affectedEndpoints: string[];
  suggestion: string;
};

const PATTERN_LABELS: Record<string, string> = {
  endpoint_unreachable: 'Endpoint Unreachable',
  payload_rejected: 'Payload Rejected',
  auth_failure: 'Auth Failure',
  timeout: 'Timeout',
  unknown: 'Unknown',
};

const PATTERN_COLORS: Record<string, string> = {
  endpoint_unreachable: 'text-red-400 bg-red-500/10 border-red-500/30',
  payload_rejected: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  auth_failure: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  timeout: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  unknown: 'text-zinc-400 bg-zinc-700 border-zinc-600',
};

export function DlqPatternAnalysis({ patterns }: { patterns: DlqPattern[] }) {
  if (patterns.length === 0) {
    return (
      <div className="text-zinc-500 text-sm">No unresolved DLQ events to analyze.</div>
    );
  }

  return (
    <div className="space-y-3">
      {patterns.map((p) => {
        const color = PATTERN_COLORS[p.pattern] ?? PATTERN_COLORS['unknown']!;
        const label = PATTERN_LABELS[p.pattern] ?? p.pattern;
        return (
          <div key={p.pattern} className={`rounded-lg border p-4 ${color}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs">{p.count} event{p.count !== 1 ? 's' : ''}</span>
            </div>
            <p className="text-xs opacity-80 mb-2">{p.suggestion}</p>
            {p.affectedEndpoints.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.affectedEndpoints.slice(0, 3).map((ep) => (
                  <span key={ep} className="text-xs font-mono bg-black/20 px-2 py-0.5 rounded truncate max-w-xs">{ep}</span>
                ))}
                {p.affectedEndpoints.length > 3 && (
                  <span className="text-xs opacity-60">+{p.affectedEndpoints.length - 3} more</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
