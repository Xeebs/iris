'use client';

type LineageNode = {
  id: string;
  connectorId: string;
  entityType: string;
  entityCount: number;
};

type ConnectorLineageDiagramProps = {
  nodes: LineageNode[];
};

const CONNECTOR_COLORS: Record<string, string> = {
  hubspot: '#f97316',
  salesforce: '#3b82f6',
  notion: '#6366f1',
  github: '#374151',
  jira: '#2563eb',
  slack: '#7c3aed',
};

function connectorColor(connectorId: string): string {
  return CONNECTOR_COLORS[connectorId] ?? '#6b7280';
}

export function ConnectorLineageDiagram({ nodes }: ConnectorLineageDiagramProps) {
  const byConnector = nodes.reduce<Record<string, LineageNode[]>>((acc, n) => {
    (acc[n.connectorId] ??= []).push(n);
    return acc;
  }, {});

  const connectors = Object.keys(byConnector);

  if (nodes.length === 0) {
    return (
      <div style={{ color: '#9ca3af', fontSize: '0.875rem', padding: '1rem' }}>
        No lineage data — connect a data source to see entity flow.
      </div>
    );
  }

  const StageLabel = ({ label }: { label: string }) => (
    <div style={{ fontSize: '0.7rem', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
      {label}
    </div>
  );

  const Arrow = () => (
    <div style={{ paddingTop: '1.9rem', color: '#d1d5db', fontSize: '1.25rem', alignSelf: 'flex-start' }}>→</div>
  );

  return (
    <div style={{ fontFamily: 'sans-serif', overflowX: 'auto' }}>
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', minWidth: 600 }}>
        {/* Connectors */}
        <div>
          <StageLabel label="Sources" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {connectors.map((cid) => (
              <div key={cid} style={{
                padding: '0.4rem 0.75rem', background: connectorColor(cid), color: '#fff',
                borderRadius: 5, fontSize: '0.8125rem', fontWeight: 600,
              }}>
                {cid}
              </div>
            ))}
          </div>
        </div>

        <Arrow />

        {/* Indexer */}
        <div>
          <StageLabel label="Indexer" />
          <div style={{ padding: '0.4rem 0.75rem', background: '#e0f2fe', color: '#0369a1', borderRadius: 5, fontSize: '0.8125rem', fontWeight: 600, border: '1px solid #bae6fd' }}>
            SemanticIndexer
          </div>
        </div>

        <Arrow />

        {/* Cache */}
        <div>
          <StageLabel label="Cache" />
          <div style={{ padding: '0.4rem 0.75rem', background: '#fef9c3', color: '#854d0e', borderRadius: 5, fontSize: '0.8125rem', fontWeight: 600, border: '1px solid #fde68a' }}>
            SemanticCache
          </div>
        </div>

        <Arrow />

        {/* MCP */}
        <div>
          <StageLabel label="MCP Consumers" />
          <div style={{ padding: '0.4rem 0.75rem', background: '#f0fdf4', color: '#166534', borderRadius: 5, fontSize: '0.8125rem', fontWeight: 600, border: '1px solid #bbf7d0' }}>
            MCP Server
          </div>
        </div>

        <div style={{ borderLeft: '1px solid #e5e7eb', paddingLeft: '1.5rem' }}>
          <StageLabel label="Entities" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {nodes.map((n) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: connectorColor(n.connectorId), flexShrink: 0 }} />
                <span style={{ fontSize: '0.8125rem', color: '#374151' }}>{n.connectorId}/{n.entityType}</span>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>({n.entityCount.toLocaleString()})</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
