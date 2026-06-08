import { Suspense } from 'react';
import { CostBreakdownCharts } from '../../../../components/cost-breakdown-charts';

interface PageProps {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}

function defaultPeriod() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

async function fetchCostSummary(
  workspaceId: string,
  from: string,
  to: string,
): Promise<{
  totalCents: number;
  byCategory: Record<string, number>;
  dailyTrend: Array<{ date: string; amountCents: number }>;
} | null> {
  try {
    const apiBase = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
    const res = await fetch(
      `${apiBase}/api/v1/workspaces/${workspaceId}/costs?from=${from}&to=${to}`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json.data;
  } catch {
    return null;
  }
}

async function fetchTopQueries(
  workspaceId: string,
  from: string,
  to: string,
): Promise<Array<{ querySignature: string; count: number; avgTokens: number }>> {
  try {
    const apiBase = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
    const res = await fetch(
      `${apiBase}/api/v1/workspaces/${workspaceId}/costs/top-queries?from=${from}&to=${to}&limit=10`,
      { next: { revalidate: 300 } },
    );
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

async function CostPageContent({ workspaceId, from, to }: { workspaceId: string; from: string; to: string }) {
  const [summary] = await Promise.all([fetchCostSummary(workspaceId, from, to)]);

  if (!summary) {
    return (
      <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 text-yellow-300 text-sm">
        Could not load cost data. Verify the API is running and this workspace exists.
      </div>
    );
  }

  return (
    <CostBreakdownCharts
      dailyTrend={summary.dailyTrend}
      byCategory={summary.byCategory as Record<'embeddings' | 'queries' | 'storage' | 'cache_miss', number>}
      totalCents={summary.totalCents}
    />
  );
}

export default function WorkspaceCostsPage({ params, searchParams }: PageProps) {
  const { from, to } = {
    ...defaultPeriod(),
    ...(searchParams.from ? { from: searchParams.from } : {}),
    ...(searchParams.to ? { to: searchParams.to } : {}),
  };
  const workspaceId = params.id;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Cost Attribution</h1>
          <p className="text-sm text-gray-400 mt-1">
            Workspace <span className="font-mono text-gray-300">{workspaceId}</span> &mdash;{' '}
            {from} to {to}
          </p>
        </div>
        <form className="flex items-center gap-2">
          <input
            type="hidden"
            name="workspaceId"
            value={workspaceId}
          />
          <label className="text-sm text-gray-400">
            From
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="ml-2 bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
            />
          </label>
          <label className="text-sm text-gray-400">
            To
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="ml-2 bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
            />
          </label>
          <button
            type="submit"
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-1.5 rounded transition-colors"
          >
            Apply
          </button>
        </form>
      </div>

      <Suspense
        fallback={
          <div className="animate-pulse space-y-4">
            <div className="h-48 bg-gray-800 rounded-xl" />
            <div className="h-32 bg-gray-800 rounded-xl" />
          </div>
        }
      >
        <CostPageContent workspaceId={workspaceId} from={from} to={to} />
      </Suspense>
    </div>
  );
}
