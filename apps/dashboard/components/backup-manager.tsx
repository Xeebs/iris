'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ExportJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  exportType: 'full' | 'entities' | 'schema';
  progressPct: number;
  entityCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface BackupManagerProps {
  workspaceId: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export function BackupManager({ workspaceId }: BackupManagerProps) {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/workspace/export/jobs`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error('Failed to fetch export jobs');
      const data = (await res.json()) as { data: ExportJob[] };
      setJobs(data.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchJobs();
    const interval = setInterval(() => {
      void fetchJobs();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const triggerExport = async (exportType: 'full' | 'entities' | 'schema') => {
    setTriggering(exportType);
    setError(null);
    try {
      const res = await fetch(`/api/v1/workspace/export/${exportType}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-id': workspaceId,
        },
        body: JSON.stringify(
          exportType === 'full'
            ? { includeGlossary: true, includeMetrics: true, includeRelationships: true }
            : {},
        ),
      });
      if (!res.ok) throw new Error('Failed to trigger export');
      await fetchJobs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setTriggering(null);
    }
  };

  const downloadExport = async (jobId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/workspace/export/jobs/${jobId}`, {
        headers: { 'x-workspace-id': workspaceId },
      });
      if (!res.ok) throw new Error('Failed to fetch export data');
      const data = (await res.json()) as { data: { resultData: unknown } };
      const blob = new Blob([JSON.stringify(data.data.resultData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `iris-backup-${jobId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Export Workspace Data</CardTitle>
          <CardDescription>
            Create a backup of your workspace entities, glossary, metrics, and relationships.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button
            onClick={() => void triggerExport('full')}
            disabled={triggering !== null}
          >
            {triggering === 'full' ? 'Starting...' : 'Full Backup'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void triggerExport('entities')}
            disabled={triggering !== null}
          >
            {triggering === 'entities' ? 'Starting...' : 'Entities Only'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void triggerExport('schema')}
            disabled={triggering !== null}
          >
            {triggering === 'schema' ? 'Starting...' : 'Schema Only'}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Export History</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exports yet.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium capitalize">{job.exportType} Export</span>
                      <Badge className={STATUS_COLORS[job.status] ?? ''} variant="secondary">
                        {job.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                      {job.entityCount !== null && ` · ${job.entityCount.toLocaleString()} entities`}
                    </p>
                    {job.status === 'running' && (
                      <div className="h-1.5 w-48 rounded-full bg-gray-200">
                        <div
                          className="h-1.5 rounded-full bg-blue-500 transition-all"
                          style={{ width: `${job.progressPct}%` }}
                        />
                      </div>
                    )}
                    {job.errorMessage && (
                      <p className="text-xs text-red-600">{job.errorMessage}</p>
                    )}
                  </div>
                  {job.status === 'completed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void downloadExport(job.id)}
                      disabled={loading}
                    >
                      Download
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
