'use client';

import { useEffect, useState } from 'react';

type Forecast = {
  likelihood1h: number;
  likelihood24h: number;
  likelihood7d: number;
  smoothedErrorRate: number;
};

type DegradationPattern = {
  anomalyDetected: boolean;
  dominantSignal: string | null;
  zScoreErrorRate: number;
  zScoreLatency: number;
  authFailures: number;
};

type Props = {
  connectorId: string;
};

function ForecastBar({ label, pct }: { label: string; pct: number }) {
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-400' : 'bg-blue-400';
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-xs">
        <span className="text-gray-600">{label}</span>
        <span className={pct > 80 ? 'font-bold text-red-700' : 'text-gray-700'}>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

/**
 * Displays connector failure forecast and anomaly detection signals.
 */
export function DegradationPredictorPanel({ connectorId }: Props) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [pattern, setPattern] = useState<DegradationPattern | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/connectors/${connectorId}/reliability`)
      .then((r) => r.json())
      .then((body) => {
        setForecast(body.data?.forecast ?? null);
        setPattern(body.data?.degradationPattern ?? null);
      })
      .catch(() => setError('Failed to load forecast data'))
      .finally(() => setLoading(false));
  }, [connectorId]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-2 rounded-lg border border-gray-200 p-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 rounded bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Failure Forecast</h3>

      {forecast ? (
        <div className="space-y-2">
          <ForecastBar label="Next 1 hour" pct={forecast.likelihood1h} />
          <ForecastBar label="Next 24 hours" pct={forecast.likelihood24h} />
          <ForecastBar label="Next 7 days" pct={forecast.likelihood7d} />
          <p className="mt-1 text-xs text-gray-400">
            Smoothed error rate: {forecast.smoothedErrorRate.toFixed(2)}%
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-400">No forecast data available.</p>
      )}

      {pattern && pattern.anomalyDetected && (
        <div className="mt-4 rounded-md bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800">Anomaly Detected</p>
          <dl className="mt-1 space-y-0.5 text-xs text-amber-700">
            {pattern.dominantSignal && (
              <div className="flex justify-between">
                <dt>Signal</dt>
                <dd className="font-medium capitalize">{pattern.dominantSignal.replace(/_/g, ' ')}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>Error rate Z-score</dt>
              <dd className="font-mono">{pattern.zScoreErrorRate.toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Latency Z-score</dt>
              <dd className="font-mono">{pattern.zScoreLatency.toFixed(2)}</dd>
            </div>
            {pattern.authFailures > 0 && (
              <div className="flex justify-between">
                <dt>Auth failures</dt>
                <dd className="font-mono text-red-700">{pattern.authFailures}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
