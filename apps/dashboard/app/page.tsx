import Link from 'next/link';
import { ConnectorCard } from '@/components/connector-card';
import { listConnectors } from '@/lib/api';

export default async function DashboardPage(): Promise<React.JSX.Element> {
  let connectors: Awaited<ReturnType<typeof listConnectors>>['data'] = [];
  try {
    const res = await listConnectors();
    connectors = res.data;
  } catch {
    // API may not be running in dev — show empty state
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Iris</h1>
          <p className="mt-1 text-gray-500">Business context intelligence layer</p>
        </div>
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/connectors" className="text-gray-600 hover:text-gray-900">
            Connectors
          </Link>
          <Link href="/queries" className="text-gray-600 hover:text-gray-900">
            Queries
          </Link>
          <Link href="/settings" className="text-gray-600 hover:text-gray-900">
            Settings
          </Link>
        </nav>
      </header>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Connected Sources</h2>
        {connectors.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
            <p className="text-gray-500">No connectors configured.</p>
            <Link
              href="/connectors"
              className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
            >
              Add a connector
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {connectors.map((c) => (
              <ConnectorCard key={c.id} connector={c} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
