'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ConfigInspectorProps {
  workspaceId?: string;
}

export function ConfigInspector({ workspaceId }: ConfigInspectorProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {workspaceId
          ? `Viewing config for workspace: ${workspaceId}`
          : 'Select a workspace to inspect its configuration.'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Rate Limits</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>API requests</span>
              <Badge variant="outline">100 / min</Badge>
            </div>
            <div className="flex justify-between">
              <span>Sync triggers</span>
              <Badge variant="outline">10 / min</Badge>
            </div>
            <div className="flex justify-between">
              <span>Webhook events</span>
              <Badge variant="outline">100 / min</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Feature Flags</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-3 px-4 space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>PII masking</span>
              <Badge className="bg-green-500 hover:bg-green-500">Enabled</Badge>
            </div>
            <div className="flex justify-between">
              <span>Benchmarking</span>
              <Badge variant="secondary">Opt-in</Badge>
            </div>
            <div className="flex justify-between">
              <span>Graph expansion</span>
              <Badge className="bg-green-500 hover:bg-green-500">Enabled</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
