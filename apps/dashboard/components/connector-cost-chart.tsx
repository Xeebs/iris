'use client';

interface ConnectorCostSummary {
  connectorId: string;
  entityCount: number;
  indexCostCents: number;
  queryCostCents: number;
  totalCostCents: number;
  tokensSpent: number;
  tokensSaved: number;
  queryCount: number;
  roiScore: number;
}

interface ConnectorCostChartProps {
  connectors: ConnectorCostSummary[];
  sortBy?: 'cost' | 'roi' | 'queries';
}

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(4)}`;
}

function roiLabel(score: number): string {
  if (!isFinite(score)) return '∞';
  return `${score.toFixed(1)}×`;
}

export function ConnectorCostChart({ connectors, sortBy = 'cost' }: ConnectorCostChartProps) {
  if (connectors.length === 0) {
    return (
      <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>
        No connector cost data for this period.
      </div>
    );
  }

  const sorted = [...connectors].sort((a, b) => {
    if (sortBy === 'roi') return (isFinite(b.roiScore) ? b.roiScore : 1e9) - (isFinite(a.roiScore) ? a.roiScore : 1e9);
    if (sortBy === 'queries') return b.queryCount - a.queryCount;
    return b.totalCostCents - a.totalCostCents;
  });

  const maxCost = Math.max(...sorted.map((c) => c.totalCostCents), 0.0001);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {sorted.map((c) => (
        <div key={c.connectorId} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
            <span style={{ fontWeight: 600 }}>{c.connectorId}</span>
            <span style={{ color: '#64748b' }}>
              {centsToDollars(c.totalCostCents)} · {c.queryCount.toLocaleString()} queries · ROI {roiLabel(c.roiScore)}
            </span>
          </div>
          <div style={{ height: '0.5rem', borderRadius: '0.25rem', background: '#f1f5f9', overflow: 'hidden' }}>
            <div style={{ display: 'flex', height: '100%' }}>
              <div
                style={{
                  width: `${(c.indexCostCents / maxCost) * 100}%`,
                  background: '#3b82f6',
                  transition: 'width 0.3s',
                }}
                title={`Index: ${centsToDollars(c.indexCostCents)}`}
              />
              <div
                style={{
                  width: `${(c.queryCostCents / maxCost) * 100}%`,
                  background: '#8b5cf6',
                  transition: 'width 0.3s',
                }}
                title={`Query: ${centsToDollars(c.queryCostCents)}`}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: '#94a3b8' }}>
            <span>
              <span style={{ display: 'inline-block', width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: '#3b82f6', marginRight: '0.25rem' }} />
              Index: {centsToDollars(c.indexCostCents)}
            </span>
            <span>
              <span style={{ display: 'inline-block', width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: '#8b5cf6', marginRight: '0.25rem' }} />
              Query: {centsToDollars(c.queryCostCents)}
            </span>
            <span>{c.entityCount.toLocaleString()} entities · {c.tokensSpent.toLocaleString()} tokens spent</span>
          </div>
        </div>
      ))}
    </div>
  );
}
