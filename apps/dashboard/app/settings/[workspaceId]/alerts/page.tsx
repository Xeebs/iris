'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertRuleEditor } from '@/components/alert-rule-editor';
import { AlertChannelManager } from '@/components/alert-channel-manager';

interface AlertRule {
  id: string;
  name: string;
  condition: 'sync_failure' | 'token_quota' | 'performance_degradation' | 'cache_miss_rate';
  threshold: number;
  enabled: boolean;
  createdAt: string;
}

interface AlertChannel {
  id: string;
  name: string;
  type: 'email' | 'slack' | 'pagerduty' | 'webhook';
  config: Record<string, unknown>;
  isDefault: boolean;
}

interface AlertEvent {
  id: string;
  ruleId: string;
  channelId: string | null;
  status: 'triggered' | 'delivered' | 'failed';
  sentAt: string;
}

export default function AlertsSettingsPage({ params }: { params: { workspaceId: string } }) {
  const { workspaceId } = params;
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesRes, channelsRes, eventsRes] = await Promise.all([
        fetch(`/api/v1/workspace/alerts/rules`),
        fetch(`/api/v1/workspace/alerts/channels`),
        fetch(`/api/v1/workspace/alerts/events?limit=20`),
      ]);
      if (!rulesRes.ok || !channelsRes.ok) throw new Error('Failed to fetch alert data');
      const rulesData = (await rulesRes.json()) as { data: AlertRule[] };
      const channelsData = (await channelsRes.json()) as { data: AlertChannel[] };
      const eventsData = eventsRes.ok ? (await eventsRes.json()) as { data: AlertEvent[] } : { data: [] };
      setRules(rulesData.data);
      setChannels(channelsData.data);
      setEvents(eventsData.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load alert settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const handleDeleteRule = async (ruleId: string) => {
    await fetch(`/api/v1/workspace/alerts/rules/${ruleId}`, { method: 'DELETE' });
    void fetchAll();
  };

  const handleDeleteChannel = async (channelId: string) => {
    await fetch(`/api/v1/workspace/alerts/channels/${channelId}`, { method: 'DELETE' });
    void fetchAll();
  };

  const handleTestAlert = async () => {
    await fetch(`/api/v1/workspace/alerts/evaluate`, { method: 'POST' });
    void fetchAll();
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Alert Settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure alert rules and notification channels for workspace {workspaceId}.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Alert Rules</TabsTrigger>
          <TabsTrigger value="channels">Notification Channels</TabsTrigger>
          <TabsTrigger value="events">Recent Events</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="mt-4">
          <AlertRuleEditor
            rules={rules}
            loading={loading}
            onDelete={handleDeleteRule}
            onCreated={fetchAll}
          />
        </TabsContent>

        <TabsContent value="channels" className="mt-4">
          <AlertChannelManager
            channels={channels}
            loading={loading}
            onDelete={handleDeleteChannel}
            onCreated={fetchAll}
            onTestAlert={handleTestAlert}
          />
        </TabsContent>

        <TabsContent value="events" className="mt-4">
          <div className="space-y-2">
            {loading && <p className="text-sm text-muted-foreground">Loading events…</p>}
            {!loading && events.length === 0 && (
              <p className="text-sm text-muted-foreground">No alert events yet.</p>
            )}
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between rounded border px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">{event.ruleId}</span>
                <span
                  className={
                    event.status === 'delivered'
                      ? 'text-green-600'
                      : event.status === 'failed'
                        ? 'text-red-600'
                        : 'text-yellow-600'
                  }
                >
                  {event.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(event.sentAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
