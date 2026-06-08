'use client';

import type { EntityTypeCount, ConnectorContribution } from '@iris/semantic-core/index-analytics';

interface CompositionChartsProps {
  byEntityType: EntityTypeCount[];
  byConnector: ConnectorContribution[];
}

const ENTITY_COLORS = ['#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

function DonutChart({ items, total }: { items: Array<{ label: string; value: number; color: string }>; total: number }) {
  let startAngle = -90;
  const cx = 80;
  const cy = 80;
  const r = 60;

  function arc(value: number) {
    const angle = (value / total) * 360;
    const endAngle = startAngle + angle;
    const start = polarToCartesian(cx, cy, r, startAngle);
    const end = polarToCartesian(cx, cy, r, endAngle);
    const largeArc = angle > 180 ? 1 : 0;
    const d = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
    startAngle += angle;
    return d;
  }

  function polarToCartesian(cx: number, cy: number, r: number, deg: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  return (
    <svg viewBox="0 0 160 160" className="w-full max-w-[160px]">
      {items.map((item) => {
        const d = arc(item.value);
        return (
          <path
            key={item.label}
            d={d}
            fill="none"
            stroke={item.color}
            strokeWidth={20}
            strokeLinecap="butt"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={40} fill="white" />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="text-xs font-bold" fontSize="14" fill="#374151">
        {total.toLocaleString()}
      </text>
    </svg>
  );
}

function BarChart({ items, total }: { items: Array<{ label: string; value: number; color: string }>; total: number }) {
  return (
    <div className="space-y-2">
      {items.slice(0, 8).map((item) => {
        const pct = total > 0 ? (item.value / total) * 100 : 0;
        return (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 truncate text-right text-gray-600">{item.label}</span>
            <div className="h-3 flex-1 rounded-full bg-gray-100">
              <div
                className="h-3 rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: item.color }}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-xs text-gray-500">{item.value.toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders a donut chart of entity type distribution and a bar chart of connector contributions.
 */
export function CompositionCharts({ byEntityType, byConnector }: CompositionChartsProps) {
  const total = byEntityType.reduce((s, r) => s + r.count, 0);

  const typeItems = byEntityType.map((r, i) => ({
    label: r.entityType,
    value: r.count,
    color: ENTITY_COLORS[i % ENTITY_COLORS.length] ?? '#6366f1',
  }));

  const connectorItems = byConnector.map((r, i) => ({
    label: r.connectorId,
    value: r.entityCount,
    color: ENTITY_COLORS[(i + 3) % ENTITY_COLORS.length] ?? '#6366f1',
  }));

  if (total === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-gray-400">
        No indexed entities
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      {/* Entity type donut */}
      <div>
        <h4 className="mb-3 text-sm font-medium text-gray-700">By Entity Type</h4>
        <div className="flex items-center gap-4">
          <DonutChart items={typeItems} total={total} />
          <div className="space-y-1.5">
            {typeItems.slice(0, 6).map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-xs">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-gray-600">{item.label}</span>
                <span className="text-gray-400">({((item.value / total) * 100).toFixed(0)}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connector contribution bars */}
      <div>
        <h4 className="mb-3 text-sm font-medium text-gray-700">By Source Connector</h4>
        <BarChart items={connectorItems} total={total} />
      </div>
    </div>
  );
}
