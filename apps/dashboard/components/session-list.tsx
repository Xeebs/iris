'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface UserSession {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  browserName: string | null;
  osName: string | null;
  countryCode: string | null;
  isActive: boolean;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
}

interface TrustedDevice {
  id: string;
  deviceName: string | null;
  fingerprint: string;
  trustedAt: string;
  lastUsedAt: string;
}

interface SessionListProps {
  workspaceId: string;
  userId: string;
}

export function SessionList({ workspaceId, userId }: SessionListProps) {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sRes, dRes] = await Promise.all([
        fetch(`/api/v1/sessions?userId=${encodeURIComponent(userId)}`, {
          headers: { 'x-workspace-id': workspaceId },
        }),
        fetch(`/api/v1/sessions/devices?userId=${encodeURIComponent(userId)}`, {
          headers: { 'x-workspace-id': workspaceId },
        }),
      ]);
      if (sRes.ok) setSessions(((await sRes.json()) as { data: UserSession[] }).data);
      if (dRes.ok) setDevices(((await dRes.json()) as { data: TrustedDevice[] }).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, userId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const revokeSession = async (id: string) => {
    if (!confirm('Revoke this session?')) return;
    setRevokingId(id);
    try {
      await fetch(`/api/v1/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      });
      await fetchData();
    } catch {
      setError('Failed to revoke session');
    } finally {
      setRevokingId(null);
    }
  };

  const revokeDevice = async (deviceId: string) => {
    if (!confirm('Remove this trusted device?')) return;
    try {
      await fetch(`/api/v1/sessions/devices/${deviceId}?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { 'x-workspace-id': workspaceId },
      });
      await fetchData();
    } catch {
      setError('Failed to revoke device');
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading sessions...</p>;

  return (
    <div className="space-y-6">
      {error && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* Active sessions */}
      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>All devices currently signed in to your account ({sessions.length}/{5} max)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-start justify-between rounded-lg border px-4 py-3">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {s.browserName ?? 'Unknown browser'}{s.osName ? ` on ${s.osName}` : ''}
                    </span>
                    {s.countryCode && (
                      <Badge className="bg-gray-100 text-gray-700 text-xs">{s.countryCode}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.ipAddress && <span>{s.ipAddress} &middot; </span>}
                    Last active {new Date(s.lastActivityAt).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Expires {new Date(s.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={revokingId === s.id}
                  onClick={() => void revokeSession(s.id)}
                >
                  {revokingId === s.id ? 'Revoking...' : 'Revoke'}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Trusted devices */}
      <Card>
        <CardHeader>
          <CardTitle>Trusted Devices</CardTitle>
          <CardDescription>Devices that bypass additional verification</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trusted devices.</p>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{d.deviceName ?? 'Unknown device'}</p>
                  <p className="text-xs text-muted-foreground">
                    Trusted {new Date(d.trustedAt).toLocaleDateString()} &middot;
                    Last used {new Date(d.lastUsedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void revokeDevice(d.id)}
                >
                  Remove
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
