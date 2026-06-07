import { ProfilerDashboard } from '@/components/profiler-dashboard';

const WORKSPACE_ID = process.env['IRIS_WORKSPACE_ID'] ?? 'default';

export default function PerformancePage(): React.JSX.Element {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Performance Profiler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          p50/p95/p99 latencies per operation and per connector, updated every 30 seconds.
        </p>
      </div>
      <ProfilerDashboard workspaceId={WORKSPACE_ID} />
    </div>
  );
}
