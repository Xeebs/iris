'use client';

import { useEffect, useState } from 'react';

type ReliabilityData = {
  score: { score: number; trend: 'improving' | 'stable' | 'degrading'; successRate: number; errorRate: number; latencyP95Ms: number };
  forecast: { likelihood1h: number; likelihood24h: number; likelihood7d: number } | null;
};

type Props = {
  connectorId: string;
  workspaceId?: string;
};

const TREND_ICONS = { improving: '↑', stable: '→', degrading: '↓' };
const TREND_COLORS = { improving: 'text-green-600', stable: 'text-gray-500', degrading: 'text-red-600' };

function scoreColor(score: number): string {
  if (score >= 90) return '#10b981';
  if (score >= 70) return '#f59e0b';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

/**
 * Gauge component showing connector reliability score with trend sparkline.
 */
export function ReliabilityGauge({ connectorId }: Props) {
  const [data, setData] = useState<ReliabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/connectors/${connectorId}/reliability`)
      .then((r) => r.json())
      .then((body) => setData(body.data))
      .catch(() => setError('Failed to load reliability data'))
      .finally(() => setLoading(false));
  }, [connectorId]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-gray-200">
        <div className="h-16 w-16 animate-pulse rounded-full bg-gray-200" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error ?? 'No data'}</p>
      </div>
    );
  }

  const { score } = data;
  const color = scoreColor(score.score);
  const circumference = 2 * Math.PI * 36;
  const progress = (score.score / 100) * circumference;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-4">
        {/* SVG gauge */}
        <div className="relative">
          <svg width="88" height="88" viewBox="0 0 88 88">
            <circle cx="44" cy="44" r="36" fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle
              cx="44"
              cy="44"
              r="36"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeDasharray={`${progress} ${circumference}`}
              strokeLinecap="round"
              transform="rotate(-90 44 44)"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-bold" style={{ color }}>{score.score}</span>
            <span className="text-[10px] text-gray-400">/ 100</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-1.5 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-500">Trend</span>
            <span className={`font-semibold ${TREND_COLORS[score.trend]}`}>
              {TREND_ICONS[score.trend]} {score.trend}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Success rate</span>
            <span className="font-mono">{(score.successRate * 100).toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Latency p95</span>
            <span className="font-mono">{score.latencyP95Ms}ms</span>
          </div>
          {data.forecast && (
            <div className="flex justify-between border-t border-gray-100 pt-1.5">
              <span className="text-gray-500">Failure (24h)</span>
              <span
                className={`font-semibold ${
                  data.forecast.likelihood24h > 50 ? 'text-red-600' : 'text-gray-700'
                }`}
              >
                {data.forecast.likelihood24h}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
