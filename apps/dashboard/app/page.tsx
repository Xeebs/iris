import Link from 'next/link';
import { ConnectorCard } from '@/components/connector-card';
import { BenchmarkingCard } from '@/components/benchmarking-card';
import { listConnectors, getTokenAnalytics } from '@/lib/api';
import type { TokenAnalyticsSummary } from '@/lib/api';

const WORKSPACE_ID = process.env['IRIS_WORKSPACE_ID'] ?? 'default';
const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

async function fetchBenchmarkData(workspaceId: string) {
  try {
    const [settingsRes, snapshotRes] = await Promise.allSettled([
      fetch(`${API_BASE}/api/v1/workspace/benchmarks/settings?workspaceId=${workspaceId}`, { next: { revalidate: 300 } }),
      fetch(`${API_BASE}/api/v1/workspace/benchmark-snapshot?workspaceId=${workspaceId}`, { next: { revalidate: 300 } }),
    ]);
    const settingsBody = settingsRes.status === 'fulfilled' && settingsRes.value.ok
      ? (await settingsRes.value.json() as { data: { workspaceId: string; benchmarkingEnabled: boolean; industry: string | null; companySize: string | null } }).data
      : { workspaceId, benchmarkingEnabled: false, industry: null, companySize: null };

    let report = null;
    if (snapshotRes.status === 'fulfilled' && snapshotRes.value.ok) {
      const compRes = await fetch(
        `${API_BASE}/api/v1/workspace/benchmarks/peer-comparison?workspaceId=${workspaceId}`,
        { next: { revalidate: 300 } },
      );
      if (compRes.ok) {
        report = (await compRes.json() as { data: unknown }).data;
      }
    }
    return { settingsBody, report };
  } catch {
    return {
      settingsBody: { workspaceId, benchmarkingEnabled: false, industry: null, companySize: null },
      report: null,
    };
  }
}

function TokenStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  );
}

export default async function DashboardPage(): Promise<React.JSX.Element> {
  let connectors: Awaited<ReturnType<typeof listConnectors>>['data'] = [];
  let tokenTotals: TokenAnalyticsSummary['totals'] = {
    tokensSpent: 0,
    tokensSaved: 0,
    cacheHitRate: 0,
    compressionRatio: 1,
  };
  let tokenQueryCount = 0;
  let benchmarkSettings = { workspaceId: WORKSPACE_ID, benchmarkingEnabled: false, industry: null as string | null, companySize: null as string | null };
  let benchmarkReport = null;

  await Promise.allSettled([
    listConnectors().then((r) => { connectors = r.data; }),
    getTokenAnalytics(WORKSPACE_ID, 30).then((r) => {
      tokenTotals = r.data.totals;
      tokenQueryCount = r.data.days.reduce((sum, d) => sum + d.queryCount, 0);
    }),
    fetchBenchmarkData(WORKSPACE_ID).then(({ settingsBody, report }) => {
      benchmarkSettings = settingsBody;
      benchmarkReport = report;
    }),
  ]);

  const savedPct =
    tokenTotals.tokensSpent + tokenTotals.tokensSaved > 0
      ? Math.round(
          (tokenTotals.tokensSaved / (tokenTotals.tokensSpent + tokenTotals.tokensSaved)) * 100,
        )
      : 0;

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
          <Link href="/analytics" className="text-gray-600 hover:text-gray-900">
            Analytics
          </Link>
          <Link href="/settings" className="text-gray-600 hover:text-gray-900">
            Settings
          </Link>
        </nav>
      </header>

      {/* Token consumption summary */}
      <section className="mb-8 rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Token Usage (30 days)</h2>
          <Link
            href="/analytics"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            View full analytics →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <TokenStat
            label="Tokens Spent"
            value={tokenTotals.tokensSpent.toLocaleString()}
            sub={`${tokenQueryCount.toLocaleString()} queries`}
          />
          <TokenStat
            label="Tokens Saved"
            value={tokenTotals.tokensSaved.toLocaleString()}
            sub={`${savedPct}% reduction`}
          />
          <TokenStat
            label="Cache Hit Rate"
            value={`${(tokenTotals.cacheHitRate * 100).toFixed(1)}%`}
            sub="Semantic cache"
          />
          <TokenStat
            label="Compression"
            value={`${tokenTotals.compressionRatio.toFixed(2)}×`}
            sub="Context ratio"
          />
        </div>
      </section>

      {/* Peer benchmarking widget */}
      <div className="mb-8">
        <BenchmarkingCard
          workspaceId={WORKSPACE_ID}
          initialSettings={benchmarkSettings}
          initialReport={benchmarkReport}
        />
      </div>

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
