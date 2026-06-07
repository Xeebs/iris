'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface DeletionRequest {
  id: string;
  workspaceId: string;
  requestedBy: string;
  reason?: string;
  status: 'none' | 'pending' | 'cancelled' | 'backup_in_progress' | 'completed';
  scheduledAt: string;
  cancelledAt?: string;
  completedAt?: string;
  createdAt: string;
}

interface DeletionPolicy {
  workspaceId: string;
  retentionDays: number;
  backupBeforeDeletion: boolean;
  legalHold: boolean;
}

function formatTimeRemaining(scheduledAt: string): string {
  const ms = new Date(scheduledAt).getTime() - Date.now();
  if (ms <= 0) return 'Grace period elapsed';
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return `${days} day${days !== 1 ? 's' : ''} remaining`;
}

function statusBadgeVariant(status: DeletionRequest['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'pending': return 'destructive';
    case 'cancelled': return 'secondary';
    case 'completed': return 'default';
    default: return 'outline';
  }
}

export default function WorkspaceDeletionPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params['workspaceId'] as string;

  const [request, setRequest] = useState<DeletionRequest | null>(null);
  const [policy, setPolicy] = useState<DeletionPolicy | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStatus();
  }, [workspaceId]);

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/v1/workspace/deletion/status`);
      if (!res.ok) throw new Error('Failed to fetch deletion status');
      const data = (await res.json()) as { data: { request: DeletionRequest | null; policy: DeletionPolicy | null } };
      setRequest(data.data.request);
      setPolicy(data.data.policy);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestDeletion() {
    if (!reason.trim()) {
      setError('Please provide a reason for deletion');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/workspace/deletion/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error: { message: string } };
        throw new Error(body.error?.message ?? 'Request failed');
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request deletion');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelDeletion() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/workspace/deletion/cancel`, { method: 'PUT' });
      if (!res.ok) {
        const body = (await res.json()) as { error: { message: string } };
        throw new Error(body.error?.message ?? 'Cancellation failed');
      }
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel deletion');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading deletion settings...</p>
      </div>
    );
  }

  const hasPendingDeletion = request?.status === 'pending' || request?.status === 'backup_in_progress';

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-destructive">Delete Workspace</h1>
        <p className="text-muted-foreground mt-1">
          Permanently remove all workspace data, entities, connectors, and configurations.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {policy?.legalHold && (
        <Alert variant="destructive">
          <AlertTitle>Legal Hold Active</AlertTitle>
          <AlertDescription>
            This workspace is under a legal hold and cannot be deleted. Contact your compliance team.
          </AlertDescription>
        </Alert>
      )}

      {hasPendingDeletion && request && (
        <Card className="border-destructive">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Deletion Scheduled</CardTitle>
              <Badge variant={statusBadgeVariant(request.status)}>
                {request.status.replace('_', ' ')}
              </Badge>
            </div>
            <CardDescription>
              {formatTimeRemaining(request.scheduledAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Scheduled deletion</span>
                <p className="font-medium">{new Date(request.scheduledAt).toLocaleDateString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Requested on</span>
                <p className="font-medium">{new Date(request.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
            {request.reason && (
              <div>
                <span className="text-sm text-muted-foreground">Reason</span>
                <p className="text-sm mt-1">{request.reason}</p>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => void handleCancelDeletion()}
              disabled={submitting || !!policy?.legalHold}
            >
              {submitting ? 'Cancelling...' : 'Cancel Deletion'}
            </Button>
          </CardContent>
        </Card>
      )}

      {!hasPendingDeletion && !policy?.legalHold && (
        <Card>
          <CardHeader>
            <CardTitle>Request Workspace Deletion</CardTitle>
            <CardDescription>
              Your workspace and all its data will be permanently deleted after a{' '}
              <strong>{policy?.retentionDays ?? 30}-day</strong> grace period.
              {policy?.backupBeforeDeletion && ' An automatic backup will be created before deletion.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertTitle>This action cannot be undone</AlertTitle>
              <AlertDescription>
                All entities, connectors, glossary terms, API keys, and team members will be permanently deleted.
                You have {policy?.retentionDays ?? 30} days to cancel after submitting.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason for deletion</Label>
              <Textarea
                id="reason"
                placeholder="Describe why you are deleting this workspace..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>

            <Button
              variant="destructive"
              onClick={() => void handleRequestDeletion()}
              disabled={submitting || !reason.trim()}
            >
              {submitting ? 'Scheduling...' : 'Schedule Workspace Deletion'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Retention Policy</CardTitle>
          <CardDescription>
            Controls how long workspace data is retained after deletion is requested.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Grace period</span>
            <p className="font-medium">{policy?.retentionDays ?? 30} days</p>
          </div>
          <div>
            <span className="text-muted-foreground">Backup before deletion</span>
            <p className="font-medium">{policy?.backupBeforeDeletion ? 'Yes' : 'No'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Legal hold</span>
            <p className="font-medium">{policy?.legalHold ? 'Active' : 'None'}</p>
          </div>
        </CardContent>
      </Card>

      <Button variant="ghost" onClick={() => router.back()}>
        Back to Settings
      </Button>
    </div>
  );
}
