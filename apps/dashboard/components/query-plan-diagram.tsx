'use client';

type ConnectorNode = {
  connectorId: string;
  estimatedLatencyMs: number;
  cacheHitRate?: number;
};

type QueryPlanDiagramProps = {
  strategy: string;
  connectors: string[];
  estimatedLatencyMs: number;
  connectorTimings?: Record<string, number>;
  cacheHits?: number;
  onClick?: (connectorId: string) => void;
};

const STRATEGY_LABELS: Record<string, string> = {
  parallel: 'Parallel',
  sequential: 'Sequential',
  'filtered-first': 'Filtered First',
  'cached-first': 'Cached First',
};

const STRATEGY_COLORS: Record<string, string> = {
  parallel: '#3b82f6',
  sequential: '#8b5cf6',
  'filtered-first': '#f59e0b',
  'cached-first': '#22c55e',
};

export function QueryPlanDiagram({
  strategy,
  connectors,
  estimatedLatencyMs,
  connectorTimings = {},
  cacheHits = 0,
  onClick,
}: QueryPlanDiagramProps) {
  const strategyColor = STRATEGY_COLORS[strategy] ?? '#6b7280';
  const isParallel = strategy === 'parallel';

  return (
    <div style={{ fontFamily: 'sans-serif', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: strategyColor, color: '#fff', padding: '0.6rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>
          {STRATEGY_LABELS[strategy] ?? strategy} Strategy
        </span>
        <span style={{ fontSize: '0.8125rem', opacity: 0.9 }}>
          Est. {estimatedLatencyMs}ms
        </span>
      </div>

      {/* Diagram */}
      <div style={{ padding: '1rem', background: '#f9fafb' }}>
        <div style={{
          display: isParallel ? 'flex' : 'flex',
          flexDirection: isParallel ? 'row' : 'column',
          gap: '0.5rem',
          alignItems: isParallel ? 'stretch' : 'flex-start',
        }}>
          {/* Query input node */}
          <div style={{
            background: '#fff', border: '2px solid #d1d5db', borderRadius: 6,
            padding: '0.5rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600, color: '#374151',
            textAlign: 'center', minWidth: 100,
          }}>
            Query
          </div>

          {isParallel ? (
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', color: '#9ca3af', fontSize: '1.2rem' }}>→</div>
          ) : (
            <div style={{ width: 2, height: 16, background: '#d1d5db', marginLeft: 49 }} />
          )}

          {/* Connector nodes */}
          {isParallel ? (
            <div style={{ display: 'flex', gap: '0.5rem', flex: 1 }}>
              {connectors.map((c) => (
                <ConnectorNode
                  key={c}
                  connectorId={c}
                  timing={connectorTimings[c]}
                  onClick={onClick}
                />
              ))}
            </div>
          ) : (
            connectors.map((c, idx) => (
              <div key={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <ConnectorNode connectorId={c} timing={connectorTimings[c]} onClick={onClick} />
                {idx < connectors.length - 1 && (
                  <div style={{ width: 2, height: 16, background: '#d1d5db', marginLeft: 49 }} />
                )}
              </div>
            ))
          )}

          {isParallel && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', color: '#9ca3af', fontSize: '1.2rem' }}>→</div>
              <div style={{
                background: '#fff', border: '2px solid #22c55e', borderRadius: 6,
                padding: '0.5rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600, color: '#15803d',
                textAlign: 'center', minWidth: 100,
              }}>
                Merge
              </div>
            </>
          )}
        </div>

        {cacheHits > 0 && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span>●</span> {cacheHits} cache hit{cacheHits !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectorNode({ connectorId, timing, onClick }: {
  connectorId: string;
  timing?: number;
  onClick?: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onClick?.(connectorId)}
      style={{
        background: '#fff', border: '1px solid #d1d5db', borderRadius: 6,
        padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: '#374151',
        cursor: onClick ? 'pointer' : 'default',
        textAlign: 'center', minWidth: 100,
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{ fontWeight: 600 }}>{connectorId}</div>
      {timing !== undefined && (
        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>{timing}ms</div>
      )}
    </div>
  );
}
