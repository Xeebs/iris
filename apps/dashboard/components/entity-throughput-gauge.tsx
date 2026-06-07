'use client';

interface ConnectorThroughput {
  connector_instance_id: string;
  total_entities: number;
  avg_duration_ms: number | null;
  error_rate: number;
  last_sync: string | null;
}

interface EntityThroughputGaugeProps {
  throughputPerSecond: number;
  connectorThroughput: ConnectorThroughput[];
  loading?: boolean;
}

function errorRateColor(rate: number): string {
  if (rate === 0) return 'text-green-600';
  if (rate < 0.05) return 'text-yellow-600';
  return 'text-red-600';
}

function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function EntityThroughputGauge({ throughputPerSecond, connectorThroughput, loading }: EntityThroughputGaugeProps) {
  if (loading) return <p className="text-sm text-muted-foreground">Loading throughput…</p>;

  const gaugeMax = 200;
  const gaugePct = Math.min((throughputPerSecond / gaugeMax) * 100, 100);
  const gaugeColor = throughputPerSecond > 100 ? 'text-green-600' : throughputPerSecond > 30 ? 'text-yellow-600' : 'text-muted-foreground';

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className={`text-4xl font-bold ${gaugeColor}`}>
          {throughputPerSecond.toFixed(1)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">entities / second (recent syncs)</p>
        <div className="w-full bg-muted rounded-full h-2 mt-2">
          <div
            className={`h-2 rounded-full transition-all ${throughputPerSecond > 100 ? 'bg-green-500' : throughputPerSecond > 30 ? 'bg-yellow-500' : 'bg-muted-foreground'}`}
            style={{ width: `${gaugePct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">0 — {gaugeMax} entities/sec scale</p>
      </div>

      {connectorThroughput.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">By Connector (last 24h)</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left pb-1">Connector</th>
                <th className="text-right pb-1">Entities</th>
                <th className="text-right pb-1">Avg Duration</th>
                <th className="text-right pb-1">Error Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {connectorThroughput.map((c) => (
                <tr key={c.connector_instance_id}>
                  <td className="py-1 font-mono truncate max-w-[120px]">{c.connector_instance_id.split('-')[0]}</td>
                  <td className="py-1 text-right">{c.total_entities.toLocaleString()}</td>
                  <td className="py-1 text-right">{formatMs(c.avg_duration_ms)}</td>
                  <td className={`py-1 text-right ${errorRateColor(c.error_rate)}`}>
                    {(c.error_rate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
