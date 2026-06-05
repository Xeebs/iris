import Link from 'next/link';
import { listAuditRecords } from '@/lib/api';

const DEFAULT_WORKSPACE = process.env['NEXT_PUBLIC_WORKSPACE_ID'] ?? 'default';

export default async function QueriesPage(): Promise<React.JSX.Element> {
  let records: Awaited<ReturnType<typeof listAuditRecords>>['data'] = [];
  try {
    const res = await listAuditRecords(DEFAULT_WORKSPACE);
    records = res.data;
  } catch {
    // API not available
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <Link href="/" className="mb-4 block text-sm text-gray-500 hover:text-gray-700">
          ← Dashboard
        </Link>
        <h1 className="text-2xl font-bold">Query Audit Log</h1>
        <p className="mt-1 text-gray-500">All MCP tool invocations for your workspace.</p>
      </header>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Tool
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Query
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Tokens
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Cache
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Duration
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Time
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {records.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-10 text-center text-sm text-gray-500"
                >
                  No audit records found.
                </td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-gray-900">
                    {r.toolName}
                  </td>
                  <td className="max-w-xs truncate px-6 py-4 text-sm text-gray-600">
                    {r.query ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {r.tokenEstimate}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm">
                    <span
                      className={
                        r.cacheHit
                          ? 'text-green-600'
                          : 'text-gray-400'
                      }
                    >
                      {r.cacheHit ? 'HIT' : 'MISS'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {r.durationMs}ms
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
