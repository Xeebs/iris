'use client';

interface ConnectorCostSummary {
  connectorId: string;
  totalCostCents: number;
  queryCount: number;
  roiScore: number;
}

interface RoiScatterplotProps {
  connectors: ConnectorCostSummary[];
}

const PLOT_WIDTH = 480;
const PLOT_HEIGHT = 280;
const PAD = { top: 20, right: 20, bottom: 48, left: 56 };

export function RoiScatterplot({ connectors }: RoiScatterplotProps) {
  const finite = connectors.filter(
    (c) => isFinite(c.roiScore) && c.totalCostCents > 0,
  );

  if (finite.length === 0) {
    return (
      <div style={{ padding: '1rem', color: '#64748b', fontSize: '0.875rem' }}>
        Not enough data to render ROI scatterplot (need cost &gt; 0 for at least one connector).
      </div>
    );
  }

  const maxCost = Math.max(...finite.map((c) => c.totalCostCents));
  const maxRoi = Math.max(...finite.map((c) => c.roiScore));

  const innerW = PLOT_WIDTH - PAD.left - PAD.right;
  const innerH = PLOT_HEIGHT - PAD.top - PAD.bottom;

  function px(costCents: number): number {
    return PAD.left + (costCents / maxCost) * innerW;
  }
  function py(roi: number): number {
    return PAD.top + innerH - (roi / maxRoi) * innerH;
  }

  const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

  return (
    <div>
      <svg
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        style={{ width: '100%', maxWidth: PLOT_WIDTH, display: 'block' }}
        aria-label="ROI scatterplot: cost vs queries per dollar"
      >
        {/* Axes */}
        <line
          x1={PAD.left} y1={PAD.top + innerH}
          x2={PAD.left + innerW} y2={PAD.top + innerH}
          stroke="#e2e8f0" strokeWidth={1}
        />
        <line
          x1={PAD.left} y1={PAD.top}
          x2={PAD.left} y2={PAD.top + innerH}
          stroke="#e2e8f0" strokeWidth={1}
        />

        {/* Axis labels */}
        <text
          x={PAD.left + innerW / 2}
          y={PLOT_HEIGHT - 4}
          textAnchor="middle"
          fontSize={11}
          fill="#64748b"
        >
          Total Cost (cents)
        </text>
        <text
          x={12}
          y={PAD.top + innerH / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#64748b"
          transform={`rotate(-90, 12, ${PAD.top + innerH / 2})`}
        >
          Queries / $
        </text>

        {/* Data points */}
        {finite.map((c, i) => (
          <g key={c.connectorId}>
            <circle
              cx={px(c.totalCostCents)}
              cy={py(c.roiScore)}
              r={6}
              fill={COLORS[i % COLORS.length]}
              fillOpacity={0.8}
            >
              <title>{c.connectorId}: cost={c.totalCostCents / 100}¢ roi={c.roiScore.toFixed(1)}</title>
            </circle>
            <text
              x={px(c.totalCostCents) + 8}
              y={py(c.roiScore) + 4}
              fontSize={9}
              fill="#475569"
            >
              {c.connectorId.slice(0, 12)}
            </text>
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem', fontSize: '0.75rem' }}>
        {finite.map((c, i) => (
          <span key={c.connectorId} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#64748b' }}>
            <span style={{ width: '0.625rem', height: '0.625rem', borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block' }} />
            {c.connectorId}
          </span>
        ))}
      </div>
    </div>
  );
}
