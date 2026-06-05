import Link from 'next/link';

export default function SettingsPage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <Link href="/" className="mb-4 block text-sm text-gray-500 hover:text-gray-700">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-gray-500">Configure your Iris workspace.</p>
      </header>

      <section className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">API Endpoint</h2>
          <p className="mt-1 text-sm text-gray-500">
            The Iris REST API that the dashboard connects to.
          </p>
          <p className="mt-3 font-mono text-sm text-gray-700">
            {process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1'}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Context Budget</h2>
          <p className="mt-1 text-sm text-gray-500">
            Default token budget for MCP query-context responses.
          </p>
          <p className="mt-3 font-mono text-sm text-gray-700">2000 tokens</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Authentication</h2>
          <p className="mt-1 text-sm text-gray-500">
            Managed by Clerk. Configure your application in the Clerk dashboard.
          </p>
        </div>
      </section>
    </main>
  );
}
