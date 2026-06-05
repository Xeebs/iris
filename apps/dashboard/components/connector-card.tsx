import type { ConnectorManifest } from '@/lib/api';

interface ConnectorCardProps {
  connector: ConnectorManifest;
}

/**
 * Display a connector manifest as a status card on the overview page.
 *
 * @param connector - Connector manifest from the API
 */
export function ConnectorCard({ connector }: ConnectorCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">{connector.name}</h3>
          <p className="mt-1 text-sm text-gray-500">{connector.description}</p>
        </div>
        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
          Active
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1">
        {connector.entityTypes.map((et) => (
          <span
            key={et}
            className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
          >
            {et}
          </span>
        ))}
      </div>
    </div>
  );
}
