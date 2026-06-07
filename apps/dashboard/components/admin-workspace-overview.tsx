'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Workspace {
  id: string;
  name: string;
  created_at: string;
  connector_count: number;
  mcp_query_volume: number;
  last_mcp_query_at: string | null;
  last_sync_at: string | null;
}

interface AdminWorkspaceOverviewProps {
  workspaces: Workspace[];
  loading: boolean;
}

export function AdminWorkspaceOverview({ workspaces, loading }: AdminWorkspaceOverviewProps) {
  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading workspaces…</p>;
  }

  if (workspaces.length === 0) {
    return <p className="text-muted-foreground text-sm">No workspaces found.</p>;
  }

  return (
    <div className="space-y-2">
      {workspaces.map((ws) => (
        <Card key={ws.id}>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{ws.name || ws.id}</CardTitle>
              <div className="flex gap-2">
                <Badge variant="outline">{ws.connector_count} connectors</Badge>
                <Badge variant="secondary">{ws.mcp_query_volume} queries/30d</Badge>
              </div>
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground mt-1">
              <span>Created {new Date(ws.created_at).toLocaleDateString()}</span>
              {ws.last_sync_at && (
                <span>Last sync {new Date(ws.last_sync_at).toLocaleDateString()}</span>
              )}
              {ws.last_mcp_query_at && (
                <span>Last query {new Date(ws.last_mcp_query_at).toLocaleDateString()}</span>
              )}
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
