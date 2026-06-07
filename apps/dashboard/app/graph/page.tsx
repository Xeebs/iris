import Link from 'next/link';
import { GraphExplorer } from './graph-explorer';
import { queryGraph } from '@/lib/api';
import type { GraphQueryResult } from '@/lib/api';

const WORKSPACE_ID = process.env['IRIS_WORKSPACE_ID'] ?? 'default';

export default async function GraphPage(): Promise<React.JSX.Element> {
  let initialData: GraphQueryResult = { nodes: [], edges: [] };

  try {
    const res = await queryGraph(WORKSPACE_ID, { limit: 100 });
    initialData = res.data;
  } catch {
    // API may be unavailable — render empty state
  }

  const entityTypes = [...new Set(initialData.nodes.map(n => n.type))].sort();
  const relTypes = [...new Set(initialData.edges.map(e => e.type))].sort();

  return (
    <main className="mx-auto max-w-screen-xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Graph</h1>
          <p className="mt-1 text-gray-500">
            {initialData.nodes.length} entities · {initialData.edges.length} relationships
          </p>
        </div>
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/" className="text-gray-600 hover:text-gray-900">Overview</Link>
          <Link href="/connectors" className="text-gray-600 hover:text-gray-900">Connectors</Link>
          <Link href="/analytics" className="text-gray-600 hover:text-gray-900">Analytics</Link>
        </nav>
      </header>

      <GraphExplorer
        initialData={initialData}
        workspaceId={WORKSPACE_ID}
        entityTypes={entityTypes}
        relTypes={relTypes}
      />
    </main>
  );
}
