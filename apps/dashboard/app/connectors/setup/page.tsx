import Link from 'next/link';
import { ConnectorSetupWizard } from '@/components/connector-setup-wizard';
import type { ConnectorManifest } from '@/lib/api';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

async function fetchConnectorTypes(): Promise<ConnectorManifest[]> {
  try {
    const res = await fetch(`${API_BASE}/connectors/types`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = (await res.json()) as { data: ConnectorManifest[] };
    return body.data;
  } catch {
    return [];
  }
}

export default async function ConnectorSetupPage(): Promise<React.JSX.Element> {
  const connectorTypes = await fetchConnectorTypes();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <Link href="/connectors" className="mb-4 block text-sm text-gray-500 hover:text-gray-700">
          ← Connectors
        </Link>
        <h1 className="text-2xl font-bold">Add a Connector</h1>
        <p className="mt-1 text-gray-500">
          Connect a data source so Iris can index and serve its context.
        </p>
      </header>

      <ConnectorSetupWizard connectorTypes={connectorTypes} apiBase={API_BASE} />
    </main>
  );
}
