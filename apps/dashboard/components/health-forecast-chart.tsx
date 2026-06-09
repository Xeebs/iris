'use client';

import React from 'react';

export type ForecastPoint = {
  date: string;
  predictedScore: number;
  confidenceLow: number;
  confidenceHigh: number;
};

export type HistoricalPoint = {
  date: string;
  healthScore: number;
};

type Props = {
  connectorId: string;
  historical: HistoricalPoint[];
  forecast: ForecastPoint[];
  trend?: 'improving' | 'stable' | 'degrading';
};

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

const WIDTH = 600;
const HEIGHT = 160;
const PADDING = { top: 12, right: 20, bottom: 24, left: 40 };

function scaleX(i: number, total: number): number {
  return PADDING.left + (i / Math.max(total - 1, 1)) * (WIDTH - PADDING.left - PADDING.right);
}

function scaleY(score: number): number {
  return HEIGHT - PADDING.bottom - ((score / 100) * (HEIGHT - PADDING.top - PADDING.bottom));
}

const TREND_STYLES = {
  improving: 'text-green-600 bg-green-50',
  stable: 'text-gray-600 bg-gray-50',
  degrading: 'text-red-600 bg-red-50',
};

export function HealthForecastChart({ connectorId, historical, forecast, trend }: Props) {
  const allPoints = [
    ...historical.map((h) => ({ date: h.date, score: h.healthScore, type: 'actual' as const })),
    ...forecast.map((f) => ({ date: f.date, score: f.predictedScore, type: 'forecast' as const })),
  ];

  const total = allPoints.length;
  const historicalCount = historical.length;

  if (total === 0) {
    return (
      <div className="p-8 text-center text-gray-500 border border-dashed rounded-lg">
        No health data available for chart.
      </div>
    );
  }

  // Build SVG path for actual line
  const actualPath = historical
    .map((h, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i, total)} ${scaleY(h.healthScore)}`)
    .join(' ');

  // Build SVG path for forecast line
  const forecastPath = forecast
    .map((f, i) => {
      const idx = historicalCount + i;
      return `${i === 0 ? 'M' : 'L'} ${scaleX(idx, total)} ${scaleY(f.predictedScore)}`;
    })
    .join(' ');

  // Build confidence band polygon
  const upperBand = forecast.map((f, i) => {
    const idx = historicalCount + i;
    return `${scaleX(idx, total)},${scaleY(f.confidenceHigh)}`;
  });
  const lowerBand = forecast.map((f, i) => {
    const idx = historicalCount + i;
    return `${scaleX(idx, total)},${scaleY(f.confidenceLow)}`;
  }).reverse();
  const bandPath = [...upperBand, ...lowerBand].join(' ');

  const lastActualScore = historical.at(-1)?.healthScore ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Health Forecast — {connectorId}</h3>
        <div className="flex items-center gap-2">
          {trend && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TREND_STYLES[trend]}`}>
              {trend === 'improving' ? '↑' : trend === 'degrading' ? '↓' : '→'} {trend}
            </span>
          )}
          {lastActualScore !== null && (
            <span className="text-xs font-bold" style={{ color: scoreColor(lastActualScore) }}>
              {lastActualScore.toFixed(0)}
            </span>
          )}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-40">
          {/* Grid lines */}
          {[25, 50, 70, 75, 100].map((y) => (
            <g key={y}>
              <line
                x1={PADDING.left} y1={scaleY(y)}
                x2={WIDTH - PADDING.right} y2={scaleY(y)}
                stroke={y === 70 ? '#fca5a5' : y === 50 ? '#ef4444' : '#f3f4f6'}
                strokeWidth={y === 70 || y === 50 ? 1 : 0.5}
                strokeDasharray={y === 70 || y === 50 ? '4,4' : undefined}
              />
              <text x={PADDING.left - 4} y={scaleY(y) + 4} textAnchor="end" fontSize="9" fill="#9ca3af">
                {y}
              </text>
            </g>
          ))}

          {/* Vertical divider: actual vs forecast */}
          {historicalCount > 0 && forecast.length > 0 && (
            <line
              x1={scaleX(historicalCount - 1, total)} y1={PADDING.top}
              x2={scaleX(historicalCount - 1, total)} y2={HEIGHT - PADDING.bottom}
              stroke="#d1d5db" strokeWidth={1} strokeDasharray="4,4"
            />
          )}

          {/* Confidence band */}
          {forecast.length > 0 && (
            <polygon points={bandPath} fill="rgba(99,102,241,0.1)" />
          )}

          {/* Forecast line */}
          {forecast.length > 0 && (
            <path d={forecastPath} fill="none" stroke="#6366f1" strokeWidth={2} strokeDasharray="6,3" />
          )}

          {/* Actual line */}
          {historical.length > 0 && (
            <path d={actualPath} fill="none" stroke={scoreColor(lastActualScore ?? 80)} strokeWidth={2} />
          )}

          {/* Forecast dots */}
          {forecast.map((f, i) => (
            <circle
              key={i}
              cx={scaleX(historicalCount + i, total)}
              cy={scaleY(f.predictedScore)}
              r={3}
              fill="#6366f1"
              opacity={0.7}
            />
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-6 h-0.5 bg-green-500" /> Actual
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-6 h-0.5 bg-indigo-400 border-dashed border-t" /> Forecast
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-4 h-3 bg-indigo-100 rounded" /> Confidence ±10
        </span>
        <span className="text-red-400">— Warning (70) · Critical (50)</span>
      </div>
    </div>
  );
}
