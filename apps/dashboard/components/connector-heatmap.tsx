'use client';

import { useRef, useEffect } from 'react';

type HeatmapCell = {
  topic: string;
  connectorId: string;
  selectionCount: number;
  exampleQueries?: string[];
};

type ConnectorHeatmapProps = {
  cells: HeatmapCell[];
  topics: string[];
  connectors: string[];
};

function getColor(count: number, max: number): string {
  if (max === 0 || count === 0) return '#f3f4f6';
  const intensity = count / max;
  const r = Math.round(59 + (220 - 59) * (1 - intensity));
  const g = Math.round(130 + (38 - 130) * intensity);
  const b = Math.round(246 + (38 - 246) * intensity);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ConnectorHeatmap({ cells, topics, connectors }: ConnectorHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const CELL_W = 80;
  const CELL_H = 36;
  const LABEL_W = 140;
  const LABEL_H = 48;

  const maxCount = Math.max(...cells.map((c) => c.selectionCount), 1);

  function getCellCount(topic: string, connectorId: string): number {
    return cells.find((c) => c.topic === topic && c.connectorId === connectorId)?.selectionCount ?? 0;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = LABEL_W + connectors.length * CELL_W;
    canvas.height = LABEL_H + topics.length * CELL_H;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px sans-serif';

    // Column headers
    connectors.forEach((conn, ci) => {
      ctx.fillStyle = '#374151';
      ctx.fillText(conn.slice(0, 9), LABEL_W + ci * CELL_W + 4, 20);
    });

    // Row headers + cells
    topics.forEach((topic, ri) => {
      const y = LABEL_H + ri * CELL_H;

      ctx.fillStyle = '#374151';
      ctx.fillText(topic.slice(0, 16), 4, y + CELL_H / 2 + 4);

      connectors.forEach((conn, ci) => {
        const count = getCellCount(topic, conn);
        const color = getColor(count, maxCount);
        const x = LABEL_W + ci * CELL_W;

        ctx.fillStyle = color;
        ctx.fillRect(x, y, CELL_W - 2, CELL_H - 2);

        if (count > 0) {
          ctx.fillStyle = count / maxCount > 0.5 ? '#fff' : '#374151';
          ctx.fillText(String(count), x + CELL_W / 2 - 8, y + CELL_H / 2 + 4);
        }
      });
    });
  }, [cells, topics, connectors]);

  if (topics.length === 0 || connectors.length === 0) {
    return <div style={{ color: '#9ca3af', fontSize: '0.875rem', padding: '1rem' }}>No affinity data yet.</div>;
  }

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.8125rem', color: '#6b7280' }}>
        <span>Low</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <div key={v} style={{ width: 20, height: 12, background: getColor(v * maxCount, maxCount), borderRadius: 2 }} />
          ))}
        </div>
        <span>High</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
      </div>
    </div>
  );
}
