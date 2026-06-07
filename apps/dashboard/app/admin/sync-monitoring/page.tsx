import { SyncMonitoringDashboard } from '@/components/sync-monitoring-dashboard';

export default function SyncMonitoringPage() {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Sync Performance Monitoring</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time view of connector sync jobs, queue depth, and entity throughput.
        </p>
      </div>
      <SyncMonitoringDashboard refreshIntervalMs={5000} />
    </div>
  );
}
