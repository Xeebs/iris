import Link from 'next/link';
import { TokenChart } from '@/components/token-chart';
import { getTokenAnalytics } from '@/lib/api';
import type { TokenAnalyticsSummary } from '@/lib/api';

const WORKSPACE_ID = process.env['IRIS_WORKSPACE_ID'] ?? 'default';

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage(): Promise<React.JSX.Element> {
  let summary: TokenAnalyticsSummary = {
    days: [],
    totals: { tokensSpent: 0, tokensSaved: 0, cacheHitRate: 0, compressionRatio: 1 },
  };

  try {
    const res = await getTokenAnalytics(WORKSPACE_ID, 30);
    summary = res.data;
  } catch {
    // API may be unavailable in dev — render empty state
  }

  const { totals, days } = summary;
  const maxTokens = days.reduce(
    (m, d) => Math.max(m, d.tokensSpent, d.tokensSavedByCaching, d.tokensSavedByCompression),
    1,
  );

  const savedPct =
    totals.tokensSpent + totals.tokensSaved > 0
      ? Math.round((totals.tokensSaved / (totals.tokensSpent + totals.tokensSaved)) * 100)
      : 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Token Analytics</h1>
          <p className="mt-1 text-gray-500">30-day token spend and savings</p>
        </div>
        <nav className="flex gap-4 text-sm font-medium">
          <Link href="/" className="text-gray-600 hover:text-gray-900">Overview</Link>
          <Link href="/connectors" className="text-gray-600 hover:text-gray-900">Connectors</Link>
          <Link href="/queries" className="text-gray-600 hover:text-gray-900">Queries</Link>
        </nav>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Tokens Spent"
          value={totals.tokensSpent.toLocaleString()}
          sub="Total output tokens billed"
        />
        <StatCard
          label="Tokens Saved"
          value={totals.tokensSaved.toLocaleString()}
          sub={`${savedPct}% reduction vs baseline`}
        />
        <StatCard
          label="Cache Hit Rate"
          value={`${(totals.cacheHitRate * 100).toFixed(1)}%`}
          sub="Semantic cache hits"
        />
        <StatCard
          label="Compression Ratio"
          value={`${totals.compressionRatio.toFixed(2)}×`}
          sub="Context before vs after compression"
        />
      </section>

      <section className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Daily Breakdown</h2>
        <TokenChart days={days} maxTokens={maxTokens} />
      </section>
    </main>
  );
}
