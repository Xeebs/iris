import { Suspense } from 'react';
import { ConnectorPerformanceLeaderboard } from '../../../components/connector-performance-leaderboard';

interface Recommendation {
  connectorId: string;
  batchSize: number;
  concurrency: number;
  paginationType: string;
  notes: string[];
}

async function fetchLeaderboard(workspaceId: string) {
  try {
    const apiBase = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}/api/v1/admin/connector-performance/leaderboard?workspaceId=${workspaceId}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

async function fetchRecommendations(workspaceId: string): Promise<Recommendation[]> {
  try {
    const apiBase = process.env['API_BASE_URL'] ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}/api/v1/admin/connector-performance/recommendations?workspaceId=${workspaceId}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data ?? [];
  } catch {
    return [];
  }
}

async function OptimizationPageContent({ workspaceId }: { workspaceId: string }) {
  const [leaderboard, recommendations] = await Promise.all([
    fetchLeaderboard(workspaceId),
    fetchRecommendations(workspaceId),
  ]);

  return (
    <div className="space-y-8">
      <div className="bg-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Performance Leaderboard</h2>
        <ConnectorPerformanceLeaderboard metrics={leaderboard} />
      </div>

      {recommendations.length > 0 && (
        <div className="bg-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Optimization Recommendations</h2>
          <ul className="space-y-4">
            {recommendations.map((rec: Recommendation) => (
              <li key={rec.connectorId} className="border border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-sm text-gray-200">{rec.connectorId}</span>
                  <span className="text-xs text-gray-400">
                    Batch: {rec.batchSize} &middot; Concurrency: {rec.concurrency} &middot; Pagination: {rec.paginationType}
                  </span>
                </div>
                {rec.notes.length > 0 && (
                  <ul className="space-y-1">
                    {rec.notes.map((note, i) => (
                      <li key={i} className="text-sm text-yellow-300 flex gap-2">
                        <span>⚠</span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ConnectorOptimizationPage({
  searchParams,
}: {
  searchParams: { workspaceId?: string };
}) {
  const workspaceId = searchParams.workspaceId ?? '';

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Connector Optimization</h1>
        <p className="text-sm text-gray-400 mt-1">
          Adaptive tuning recommendations and performance leaderboard
        </p>
      </div>

      {!workspaceId ? (
        <div className="bg-gray-800 rounded-xl p-6 text-gray-400 text-sm">
          Pass <code className="text-indigo-400">?workspaceId=...</code> to load connector performance data.
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="animate-pulse space-y-4">
              <div className="h-64 bg-gray-800 rounded-xl" />
              <div className="h-32 bg-gray-800 rounded-xl" />
            </div>
          }
        >
          <OptimizationPageContent workspaceId={workspaceId} />
        </Suspense>
      )}
    </div>
  );
}
