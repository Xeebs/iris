import { SyncQualityMonitor } from '@/components/sync-quality-monitor';

interface PageProps {
  searchParams: Promise<{ connectorId?: string; workspaceId?: string; windowDays?: string }>;
}

export default async function SyncQualityPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const connectorId = params.connectorId ?? '';
  const workspaceId = params.workspaceId ?? '';
  const windowDays = params.windowDays ? parseInt(params.windowDays, 10) : 30;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Connector Sync Quality</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor attribute completeness, schema stability, and anomaly detection across sync runs.
        </p>
      </div>

      {!connectorId || !workspaceId ? (
        <div className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
          Provide{' '}
          <code className="font-mono text-xs bg-muted px-1 rounded">?connectorId=&amp;workspaceId=</code>{' '}
          query parameters to view sync quality for a specific connector.
        </div>
      ) : (
        <SyncQualityMonitor
          connectorId={connectorId}
          workspaceId={workspaceId}
          windowDays={windowDays}
        />
      )}
    </div>
  );
}
