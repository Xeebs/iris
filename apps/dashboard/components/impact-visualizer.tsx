'use client';

type ImpactResult = {
  entityId: string;
  affectedEntityIds: string[];
  depth: number;
  affectedCount: number;
  changeType?: string;
};

type Props = {
  impact: ImpactResult | null;
  loading: boolean;
};

function ImpactRing({ count, depth }: { count: number; depth: number }) {
  const severity = count === 0 ? 'none' : count < 5 ? 'low' : count < 20 ? 'medium' : 'high';
  const colors = { none: '#16a34a', low: '#ca8a04', medium: '#ea580c', high: '#dc2626' };
  const bg = { none: '#f0fdf4', low: '#fefce8', medium: '#fff7ed', high: '#fef2f2' };
  const color = colors[severity];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 20 }}>
      <div style={{ width: 120, height: 120, borderRadius: '50%', background: bg[severity], border: `4px solid ${color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 800, color }}>{count}</div>
        <div style={{ fontSize: 10, color: '#6b7280' }}>affected</div>
      </div>
      <div style={{ fontSize: 12, color, fontWeight: 700 }}>{severity.toUpperCase()} IMPACT</div>
      <div style={{ fontSize: 11, color: '#6b7280' }}>traversal depth: {depth}</div>
    </div>
  );
}

/**
 * Visualizes the impact radius of a change to an entity, showing how many downstream entities are affected.
 * @param impact - Impact analysis result to display
 * @param loading - Whether analysis is in progress
 * @returns Rendered impact visualizer with ring and affected entity list
 */
export function ImpactVisualizer({ impact, loading }: Props) {
  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>Analyzing impact…</div>;
  }

  if (!impact) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb', borderRadius: 10 }}>
        Enter an entity ID and click Analyze to see change impact.
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <ImpactRing count={impact.affectedCount} depth={impact.depth} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 14 }}>
            Affected Entities {impact.changeType && <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>({impact.changeType})</span>}
          </div>
          {impact.affectedEntityIds.length === 0 ? (
            <div style={{ color: '#9ca3af', fontSize: 13 }}>No downstream entities will be affected.</div>
          ) : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {impact.affectedEntityIds.map(id => (
                <div key={id} style={{ padding: '5px 8px', borderBottom: '1px solid #f3f4f6', fontSize: 12, fontFamily: 'monospace', color: '#374151' }}>
                  {id}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
