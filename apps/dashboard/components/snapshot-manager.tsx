'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SnapshotRecord {
  id: string;
  workspaceId: string;
  status: 'creating' | 'ready' | 'failed' | 'restoring' | 'deleted';
  entityCount: number | null;
  snapshotSizeBytes: number | null;
  retentionDays: number;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

interface SnapshotManagerProps {
  workspaceId: string;
}

const STATUS_COLORS: Record<string, string> = {
  creating: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  restoring: 'bg-blue-100 text-blue-800',
  deleted: 'bg-gray-100 text-gray-500',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SnapshotManager({ workspaceId }: SnapshotManagerProps) {
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/snapshots', {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error('Failed to fetch snapshots');
      const data = (await res.json()) as { data: SnapshotRecord[] };
      setSnapshots(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshots');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchSnapshots();
    const interval = setInterval(() => void fetchSnapshots(), 8000);
    return () => clearInterval(interval);
  }, [fetchSnapshots]);

  const createSnapshot = async () => {
    setCreating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/v1/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-workspace-id': workspaceId },
        body: JSON.stringify({ retentionDays: 30 }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error: { message: string } };
        throw new Error(body.error?.message ?? 'Failed to create snapshot');
      }
      setSuccessMsg('Snapshot creation started.');
      await fetchSnapshots();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create snapshot');
    } finally {
      setCreating(false);
    }
  };

  const restoreSnapshot = async (snapshotId: string) => {
    if (!confirm('Restoring a snapshot will replace all current workspace data. Continue?')) return;
    setRestoringId(snapshotId);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/v1/snapshots/${snapshotId}/restore`, {
        method: 'POST',
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) {
        const body = (await res.json()) as { error: { message: string } };
        throw new Error(body.error?.message ?? 'Failed to restore snapshot');
      }
      const body = (await res.json()) as { data: { restoredCount: number } };
      setSuccessMsg(`Restored ${body.data.restoredCount} entities from snapshot.`);
      await fetchSnapshots();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore snapshot');
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Index Snapshots</CardTitle>
          <CardDescription>
            Create and restore point-in-time backups of your workspace entities for disaster recovery.
          </CardDescription>
        </div>
        <Button onClick={() => void createSnapshot()} disabled={creating} size="sm">
          {creating ? 'Creating...' : 'New Snapshot'}
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}
        {successMsg && (
          <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{successMsg}</div>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading snapshots...</p>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No snapshots yet. Create one to enable disaster recovery.</p>
        ) : (
          <div className="space-y-3">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_COLORS[snap.status] ?? ''}>{snap.status}</Badge>
                    <span className="text-sm font-medium">
                      {snap.entityCount !== null ? `${snap.entityCount} entities` : 'In progress'}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatBytes(snap.snapshotSizeBytes)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(snap.createdAt).toLocaleString()}
                    {snap.expiresAt && <> &middot; Expires {new Date(snap.expiresAt).toLocaleDateString()}</>}
                  </div>
                </div>
                {snap.status === 'ready' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoringId === snap.id}
                    onClick={() => void restoreSnapshot(snap.id)}
                  >
                    {restoringId === snap.id ? 'Restoring...' : 'Restore'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
