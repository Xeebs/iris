'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ServiceCheck {
  status: 'ok' | 'error';
  latencyMs?: number;
  message?: string;
}

interface SystemHealthData {
  status: 'ok' | 'degraded';
  checks: Record<string, ServiceCheck>;
  timestamp: string;
}

interface SystemHealthMonitorProps {
  data: SystemHealthData | null;
  loading: boolean;
}

function statusBadge(status: 'ok' | 'error') {
  return status === 'ok' ? (
    <Badge className="bg-green-500 hover:bg-green-500">OK</Badge>
  ) : (
    <Badge variant="destructive">Error</Badge>
  );
}

export function SystemHealthMonitor({ data, loading }: SystemHealthMonitorProps) {
  if (loading) {
    return <p className="text-muted-foreground text-sm">Checking system health…</p>;
  }

  if (!data) {
    return <p className="text-muted-foreground text-sm">Health data unavailable.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Overall:</span>
        {data.status === 'ok'
          ? <Badge className="bg-green-500 hover:bg-green-500">Healthy</Badge>
          : <Badge variant="destructive">Degraded</Badge>
        }
        <span className="text-xs text-muted-foreground">as of {new Date(data.timestamp).toLocaleTimeString()}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Object.entries(data.checks).map(([name, check]) => (
          <Card key={name}>
            <CardHeader className="py-2 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm capitalize">{name.replace(/_/g, ' ')}</CardTitle>
                {statusBadge(check.status)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {check.latencyMs != null && <span>{check.latencyMs}ms · </span>}
                {check.message && <span>{check.message}</span>}
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
