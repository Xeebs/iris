'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

type AlertCondition = 'sync_failure' | 'token_quota' | 'performance_degradation' | 'cache_miss_rate';

interface AlertRule {
  id: string;
  name: string;
  condition: AlertCondition;
  threshold: number;
  enabled: boolean;
  createdAt: string;
}

const CONDITION_LABELS: Record<AlertCondition, string> = {
  sync_failure: 'Sync Failures (last hour)',
  token_quota: 'Token Quota (daily)',
  performance_degradation: 'Avg Sync Duration (ms)',
  cache_miss_rate: 'Cache Miss Rate',
};

interface Props {
  rules: AlertRule[];
  loading: boolean;
  onDelete: (ruleId: string) => void;
  onCreated: () => void;
}

export function AlertRuleEditor({ rules, loading, onDelete, onCreated }: Props) {
  const [name, setName] = useState('');
  const [condition, setCondition] = useState<AlertCondition>('sync_failure');
  const [threshold, setThreshold] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreate = async () => {
    setFormError(null);
    if (!name.trim() || !threshold) {
      setFormError('Name and threshold are required.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/workspace/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), condition, threshold: Number(threshold) }),
      });
      if (!res.ok) throw new Error('Failed to create rule');
      setName('');
      setThreshold('');
      onCreated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create rule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Alert Rule</CardTitle>
          <CardDescription>Define a condition and threshold to trigger notifications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="rule-name">Rule Name</Label>
              <Input
                id="rule-name"
                placeholder="e.g. High Sync Failures"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-condition">Condition</Label>
              <select
                id="rule-condition"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={condition}
                onChange={(e) => setCondition(e.target.value as AlertCondition)}
              >
                {Object.entries(CONDITION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-threshold">Threshold</Label>
              <Input
                id="rule-threshold"
                type="number"
                placeholder="e.g. 3"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
          </div>
          <Button onClick={() => void handleCreate()} disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Rule'}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading rules…</p>}
        {!loading && rules.length === 0 && (
          <p className="text-sm text-muted-foreground">No alert rules configured.</p>
        )}
        {rules.map((rule) => (
          <Card key={rule.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
              <div>
                <CardTitle className="text-sm">{rule.name}</CardTitle>
                <CardDescription className="text-xs">
                  {CONDITION_LABELS[rule.condition]} ≥ {rule.threshold}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                  {rule.enabled ? 'enabled' : 'disabled'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(rule.id)}
                  className="text-destructive hover:text-destructive"
                >
                  Delete
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
