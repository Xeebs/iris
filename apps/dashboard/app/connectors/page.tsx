import Link from 'next/link';
import { listConnectors } from '@/lib/api';

export default async function ConnectorsPage(): Promise<React.JSX.Element> {
  let connectors: Awaited<ReturnType<typeof listConnectors>>['data'] = [];
  try {
    const res = await listConnectors();
    connectors = res.data;
  } catch {
    // API not available
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <Link href="/" className="mb-4 block text-sm text-gray-500 hover:text-gray-700">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Connectors</h1>
        <p className="mt-1 text-gray-500">Connect your business data sources to Iris.</p>
      </header>

      <div className="space-y-4">
        {connectors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <p className="text-gray-500">
              No connectors available. Ensure the API is running and connectors are registered.
            </p>
          </div>
        ) : (
          connectors.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div>
                <h2 className="font-semibold text-gray-900">{c.name}</h2>
                <p className="mt-0.5 text-sm text-gray-500">{c.description}</p>
                <p className="mt-1 text-xs text-gray-400">
                  Entity types: {c.entityTypes.join(', ')}
                </p>
              </div>
              <button
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                type="button"
              >
                Connect
              </button>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
