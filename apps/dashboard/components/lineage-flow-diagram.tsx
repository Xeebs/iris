'use client';

type LineageNode = {
  entityId: string;
  depth: number;
  relationshipType: string;
  direction: 'ancestor' | 'descendant';
};

type Props = {
  entityId: string;
  ancestors: Array<{ entityId: string; depth: number; relationshipType: string }>;
  descendants: Array<{ entityId: string; depth: number; relationshipType: string }>;
};

function NodeBadge({ node, direction }: { node: LineageNode; direction: 'ancestor' | 'descendant' }) {
  const color = direction === 'ancestor' ? '#7c3aed' : '#0891b2';
  const bg = direction === 'ancestor' ? '#f5f3ff' : '#ecfeff';
  const border = direction === 'ancestor' ? '#ddd6fe' : '#a5f3fc';
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ padding: '6px 12px', background: bg, border: `1px solid ${border}`, borderRadius: 8, fontSize: 12, fontFamily: 'monospace', color, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {node.entityId}
      </div>
      <div style={{ fontSize: 10, color: '#9ca3af' }}>{node.relationshipType} · depth {node.depth}</div>
    </div>
  );
}

function Arrow({ direction }: { direction: 'ancestor' | 'descendant' }) {
  return (
    <div style={{ fontSize: 18, color: '#d1d5db', margin: '0 4px', alignSelf: 'center' }}>
      {direction === 'ancestor' ? '←' : '→'}
    </div>
  );
}

/**
 * Visual flow diagram showing a lineage graph: ancestors on the left, root in the center, descendants on the right.
 * @param entityId - Root entity ID
 * @param ancestors - Upstream entities (what this entity was derived from)
 * @param descendants - Downstream entities (what depends on this entity)
 * @returns Rendered lineage flow diagram
 */
export function LineageFlowDiagram({ entityId, ancestors, descendants }: Props) {
  const ancestorNodes: LineageNode[] = ancestors.map(a => ({ ...a, direction: 'ancestor' as const }));
  const descendantNodes: LineageNode[] = descendants.map(d => ({ ...d, direction: 'descendant' as const }));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '16px 0', minWidth: 400 }}>
        {/* Ancestors column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
          {ancestorNodes.length > 0 ? (
            ancestorNodes.map(n => <NodeBadge key={n.entityId} node={n} direction="ancestor" />)
          ) : (
            <div style={{ padding: '6px 12px', color: '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>No ancestors</div>
          )}
        </div>

        {ancestorNodes.length > 0 && <Arrow direction="ancestor" />}

        {/* Root node */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{ padding: '8px 16px', background: '#fff7ed', border: '2px solid #fed7aa', borderRadius: 8, fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#c2410c', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entityId}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>ROOT</div>
        </div>

        {descendantNodes.length > 0 && <Arrow direction="descendant" />}

        {/* Descendants column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 180 }}>
          {descendantNodes.length > 0 ? (
            descendantNodes.map(n => <NodeBadge key={n.entityId} node={n} direction="descendant" />)
          ) : (
            <div style={{ padding: '6px 12px', color: '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>No descendants</div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: '#6b7280' }}>
        <span><span style={{ color: '#7c3aed', fontWeight: 700 }}>■</span> Ancestor (derived from)</span>
        <span><span style={{ color: '#ea580c', fontWeight: 700 }}>■</span> Root entity</span>
        <span><span style={{ color: '#0891b2', fontWeight: 700 }}>■</span> Descendant (depends on root)</span>
      </div>
    </div>
  );
}
