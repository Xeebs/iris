import Link from 'next/link';

const API_BASE = process.env['NEXT_PUBLIC_API_URL']?.replace('/api/v1', '') ?? 'http://localhost:3001';

export default function DocsPage(): React.JSX.Element {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900">API Documentation</h1>
        <p className="mt-2 text-gray-500">
          Interactive API reference for all Iris REST endpoints.
        </p>
      </header>

      <div className="space-y-4">
        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">Swagger UI</h2>
          <p className="text-sm text-gray-500 mb-4">
            Explore and try all endpoints interactively. Requires the API server to be running.
          </p>
          <a
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700"
          >
            Open Swagger UI →
          </a>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">OpenAPI JSON Spec</h2>
          <p className="text-sm text-gray-500 mb-4">
            Download the raw OpenAPI 3.0 specification for use with code generators or other tools.
          </p>
          <a
            href={`${API_BASE}/openapi.json`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border text-sm font-medium rounded hover:bg-gray-50"
          >
            Download openapi.json
          </a>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">Authentication</h2>
          <p className="text-sm text-gray-500 mb-2">
            The REST API uses Clerk-issued JWTs. Pass your token as:
          </p>
          <pre className="text-xs font-mono bg-gray-50 border rounded p-3 text-gray-700">
            {`Authorization: Bearer <your-clerk-jwt>`}
          </pre>
          <p className="mt-2 text-sm text-gray-500">
            The MCP server uses scoped API keys. Manage them in{' '}
            <Link href="/settings" className="text-blue-600 hover:underline">Workspace Settings → API Keys</Link>.
          </p>
        </div>

        <div className="rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">API Conventions</h2>
          <ul className="text-sm text-gray-600 space-y-1.5 list-disc list-inside">
            <li>Base path: <code className="font-mono text-xs bg-gray-100 px-1 rounded">/api/v1/</code></li>
            <li>All routes are kebab-case: <code className="font-mono text-xs bg-gray-100 px-1 rounded">/connector-instances</code></li>
            <li>Success: <code className="font-mono text-xs bg-gray-100 px-1 rounded">{'{"data": T}'}</code> or <code className="font-mono text-xs bg-gray-100 px-1 rounded">{'{"data": T, "meta": {hasMore, nextCursor}}'}</code></li>
            <li>Error: <code className="font-mono text-xs bg-gray-100 px-1 rounded">{'{"error": {"code": string, "message": string}}'}</code></li>
            <li>Pagination: cursor-based — pass <code className="font-mono text-xs bg-gray-100 px-1 rounded">?cursor=</code> + <code className="font-mono text-xs bg-gray-100 px-1 rounded">?limit=</code> (default 50, max 200)</li>
            <li>All authenticated routes require <code className="font-mono text-xs bg-gray-100 px-1 rounded">workspaceId</code> for tenant isolation</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
