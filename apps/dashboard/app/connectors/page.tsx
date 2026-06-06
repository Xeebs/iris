import Link from 'next/link';
import { listConnectors, getAllConnectorHealth } from '@/lib/api';
import type { ConnectorHealthSummary } from '@/lib/api';

const DEFAULT_WORKSPACE = process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default';

const HEALTH_CONFIG = {
  healthy: { label: 'Healthy', dot: 'bg-green-500', text: 'text-green-700' },
  degraded: { label: 'Degraded', dot: 'bg-yellow-500', text: 'text-yellow-700' },
  unhealthy: { label: 'Unhealthy', dot: 'bg-red-500', text: 'text-red-700' },
} as const;

export default async function ConnectorsPage(): Promise<React.JSX.Element> {
  let connectors: Awaited<ReturnType<typeof listConnectors>>['data'] = [];
  let healthMap: Record<string, ConnectorHealthSummary> = {};

  try {
    const [connectorsRes, healthList] = await Promise.allSettled([
      listConnectors(),
      getAllConnectorHealth(DEFAULT_WORKSPACE),
    ]);

    if (connectorsRes.status === 'fulfilled') {
      connectors = connectorsRes.value.data;
    }
    if (healthList.status === 'fulfilled') {
      healthMap = Object.fromEntries(healthList.value.map((h) => [h.instanceId, h]));
    }
  } catch {
    // API not available
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <Link href="/" className="mb-4 block text-sm text-gray-500 hover:text-gray-700">
          ← Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Connectors</h1>
            <p className="mt-1 text-gray-500">Connect your business data sources to Iris.</p>
          </div>
          <Link
            href="/connectors/setup"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Add Connector
          </Link>
        </div>
      </header>

      <div className="space-y-4">
        {connectors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <p className="text-gray-500">
              No connectors available. Ensure the API is running and connectors are registered.
            </p>
          </div>
        ) : (
          connectors.map((c) => {
            const health = healthMap[c.id];
            const hConfig = health ? HEALTH_CONFIG[health.status] : null;
            return (
              <div
                key={c.id}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
                data-testid="connector-row"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h2 className="font-semibold text-gray-900">{c.name}</h2>
                      {hConfig && (
                        <span className="flex items-center gap-1.5 text-xs font-medium" data-testid="health-badge">
                          <span className={`inline-block w-2 h-2 rounded-full ${hConfig.dot}`} />
                          <span className={hConfig.text}>{hConfig.label}</span>
                          {health?.latencyMs !== null && (
                            <span className="text-gray-400">({health?.latencyMs}ms)</span>
                          )}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-gray-500">{c.description}</p>
                    <p className="mt-1 text-xs text-gray-400">
                      Entity types: {c.entityTypes.join(', ')}
                    </p>
                    {health?.errorMessage && (
                      <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1 font-mono">
                        {health.errorMessage}
                      </p>
                    )}
                    {health && (
                      <p className="mt-1 text-xs text-gray-400">
                        Last checked: {new Date(health.checkedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <button
                    className="ml-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 shrink-0"
                    type="button"
                  >
                    Connect
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
