'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { AdminWorkspaceOverview } from '@/components/admin-workspace-overview';
import { SystemHealthMonitor } from '@/components/system-health-monitor';
import { ConfigInspector } from '@/components/config-inspector';

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  connector_count: number;
  mcp_query_volume: number;
  last_mcp_query_at: string | null;
  last_sync_at: string | null;
}

interface SystemHealth {
  status: 'ok' | 'degraded';
  checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number; message?: string }>;
  timestamp: string;
}

interface ErrorEntry {
  id: string;
  connector_instance_id: string;
  workspace_id: string;
  job_id: string;
  status: string;
  error_count: number;
  started_at: string;
}

function AdminErrorLog({ errors, loading }: { errors: ErrorEntry[]; loading: boolean }) {
  if (loading) return <p className="text-muted-foreground text-sm">Loading error log…</p>;
  if (errors.length === 0) return <p className="text-muted-foreground text-sm">No sync failures in the last 7 days.</p>;
  return (
    <div className="space-y-2">
      {errors.map((e) => (
        <Card key={e.id}>
          <CardHeader className="py-2 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{e.connector_instance_id}</CardTitle>
              <Badge variant="destructive">{e.error_count} errors</Badge>
            </div>
            <CardDescription className="text-xs">
              Workspace: {e.workspace_id} · {new Date(e.started_at).toLocaleString()}
            </CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

export default function AdminConsolePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [loadingErrors, setLoadingErrors] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    setLoadingWorkspaces(true);
    try {
      const res = await fetch('/api/v1/admin/workspaces');
      if (res.status === 403) {
        setAuthError('Admin access required. You must be an organization admin to view this page.');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch workspaces');
      const data = (await res.json()) as { data: Workspace[] };
      setWorkspaces(data.data);
    } catch {
      setWorkspaces([]);
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const res = await fetch('/api/v1/admin/system-health');
      if (!res.ok && res.status !== 503) throw new Error('Failed');
      const data = (await res.json()) as { data: SystemHealth };
      setSystemHealth(data.data);
    } catch {
      setSystemHealth(null);
    } finally {
      setLoadingHealth(false);
    }
  }, []);

  const fetchErrors = useCallback(async () => {
    setLoadingErrors(true);
    try {
      const res = await fetch('/api/v1/admin/errors?days=7');
      if (!res.ok) throw new Error('Failed');
      const data = (await res.json()) as { data: { errors: ErrorEntry[] } };
      setErrors(data.data.errors);
    } catch {
      setErrors([]);
    } finally {
      setLoadingErrors(false);
    }
  }, []);

  useEffect(() => {
    void fetchWorkspaces();
    void fetchHealth();
    void fetchErrors();
  }, [fetchWorkspaces, fetchHealth, fetchErrors]);

  if (authError) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertDescription>{authError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin Console</h1>
          <p className="text-muted-foreground">System health, workspace management, and diagnostics.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void fetchWorkspaces();
            void fetchHealth();
            void fetchErrors();
          }}
        >
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="workspaces">
        <TabsList>
          <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
          <TabsTrigger value="errors">Error Analysis</TabsTrigger>
          <TabsTrigger value="config">Config Inspector</TabsTrigger>
        </TabsList>

        <TabsContent value="workspaces" className="mt-4">
          <AdminWorkspaceOverview workspaces={workspaces} loading={loadingWorkspaces} />
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <SystemHealthMonitor data={systemHealth} loading={loadingHealth} />
        </TabsContent>

        <TabsContent value="errors" className="mt-4">
          <AdminErrorLog errors={errors} loading={loadingErrors} />
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <ConfigInspector />
        </TabsContent>
      </Tabs>
    </div>
  );
}
