export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ConnectorHealthSummary {
  instanceId: string;
  workspaceId: string;
  status: ConnectorHealthStatus;
  latencyMs: number | null;
  errorMessage: string | null;
  checkedAt: string;
}

interface ConnectorHealthCardProps {
  health: ConnectorHealthSummary;
  connectorName?: string;
}

const STATUS_COLORS: Record<ConnectorHealthStatus, { bg: string; text: string; dot: string }> = {
  healthy: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  degraded: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  unhealthy: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

/**
 * Display the live health status for a connector instance.
 *
 * @param health       - Health summary fetched from GET /api/v1/connectors/:id/health
 * @param connectorName - Optional display name for the connector
 */
export function ConnectorHealthCard({ health, connectorName }: ConnectorHealthCardProps): React.JSX.Element {
  const colors = STATUS_COLORS[health.status];
  const checkedAt = new Date(health.checkedAt).toLocaleString();

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${colors.dot}`} aria-hidden="true" />
          <div>
            <p className="font-medium text-gray-900">
              {connectorName ?? health.instanceId}
            </p>
            <p className="text-xs text-gray-400">Checked at {checkedAt}</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors.bg} ${colors.text}`}
        >
          {health.status}
        </span>
      </div>

      {health.latencyMs !== null && (
        <p className="mt-3 text-sm text-gray-500">
          Latency:{' '}
          <span className="font-medium text-gray-700">{health.latencyMs} ms</span>
        </p>
      )}

      {health.errorMessage && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2">
          <p className="text-xs text-red-700">{health.errorMessage}</p>
        </div>
      )}
    </div>
  );
}
