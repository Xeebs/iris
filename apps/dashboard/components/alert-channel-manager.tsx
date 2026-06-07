'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

type ChannelType = 'email' | 'slack' | 'pagerduty' | 'webhook';

interface AlertChannel {
  id: string;
  name: string;
  type: ChannelType;
  config: Record<string, unknown>;
  isDefault: boolean;
}

const CHANNEL_CONFIG_FIELDS: Record<ChannelType, { key: string; label: string; placeholder: string }[]> = {
  slack: [{ key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/…' }],
  pagerduty: [{ key: 'routingKey', label: 'Routing Key', placeholder: 'abc123…' }],
  webhook: [{ key: 'url', label: 'Endpoint URL', placeholder: 'https://your-endpoint.example.com/alert' }],
  email: [{ key: 'address', label: 'Email Address', placeholder: 'ops@example.com' }],
};

interface Props {
  channels: AlertChannel[];
  loading: boolean;
  onDelete: (channelId: string) => void;
  onCreated: () => void;
  onTestAlert: () => void;
}

export function AlertChannelManager({ channels, loading, onDelete, onCreated, onTestAlert }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ChannelType>('slack');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const configFields = CHANNEL_CONFIG_FIELDS[type];

  const handleTypeChange = (newType: ChannelType) => {
    setType(newType);
    setConfig({});
  };

  const handleCreate = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError('Channel name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/workspace/alerts/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, config, isDefault }),
      });
      if (!res.ok) throw new Error('Failed to create channel');
      setName('');
      setConfig({});
      setIsDefault(false);
      onCreated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create channel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Notification Channel</CardTitle>
          <CardDescription>Add a channel to receive alerts via Slack, PagerDuty, webhook, or email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="ch-name">Channel Name</Label>
              <Input
                id="ch-name"
                placeholder="e.g. Slack Ops"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ch-type">Type</Label>
              <select
                id="ch-type"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={type}
                onChange={(e) => handleTypeChange(e.target.value as ChannelType)}
              >
                <option value="slack">Slack</option>
                <option value="pagerduty">PagerDuty</option>
                <option value="webhook">Webhook</option>
                <option value="email">Email</option>
              </select>
            </div>
          </div>

          {configFields.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`ch-cfg-${key}`}>{label}</Label>
              <Input
                id={`ch-cfg-${key}`}
                placeholder={placeholder}
                value={config[key] ?? ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
              />
            </div>
          ))}

          <div className="flex items-center gap-2">
            <input
              id="ch-default"
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="ch-default" className="font-normal">
              Use as default channel for all triggered rules
            </Label>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void handleCreate()} disabled={submitting}>
              {submitting ? 'Adding…' : 'Add Channel'}
            </Button>
            <Button variant="outline" onClick={onTestAlert}>
              Test Alerts Now
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading channels…</p>}
        {!loading && channels.length === 0 && (
          <p className="text-sm text-muted-foreground">No notification channels configured.</p>
        )}
        {channels.map((channel) => (
          <Card key={channel.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
              <div>
                <CardTitle className="text-sm">{channel.name}</CardTitle>
                <CardDescription className="text-xs capitalize">{channel.type}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {channel.isDefault && <Badge variant="outline">default</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(channel.id)}
                  className="text-destructive hover:text-destructive"
                >
                  Remove
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
