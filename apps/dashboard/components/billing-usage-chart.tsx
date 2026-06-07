'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface BillingTier {
  tierName: string;
  monthlyBaseCents: number;
  entityIndexPriceCents: number;
  queryPriceCents: number;
  includedTokens: number;
}

interface UsageSummary {
  workspaceId: string;
  tier: BillingTier;
  usageCounts: {
    entity_indexed: number;
    query_executed: number;
    token_spent: number;
    api_call: number;
  };
  baseChargeCents: number;
  usageChargeCents: number;
  totalChargeCents: number;
  forecastedMonthEndCents: number;
}

interface BillingPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalChargesCents: number;
  status: 'open' | 'invoiced' | 'paid';
}

interface BillingUsageChartProps {
  workspaceId: string;
}

const TIER_COLORS: Record<string, string> = {
  starter: 'bg-gray-100 text-gray-700',
  growth: 'bg-blue-100 text-blue-700',
  enterprise: 'bg-purple-100 text-purple-700',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-800',
  invoiced: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-800',
};

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function BillingUsageChart({ workspaceId }: BillingUsageChartProps) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [periods, setPeriods] = useState<BillingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [uRes, pRes] = await Promise.all([
        fetch('/api/v1/billing/usage', { headers: { 'x-workspace-id': workspaceId } }),
        fetch('/api/v1/billing/periods', { headers: { 'x-workspace-id': workspaceId } }),
      ]);
      if (uRes.ok) setUsage(((await uRes.json()) as { data: UsageSummary }).data);
      if (pRes.ok) setPeriods(((await pRes.json()) as { data: BillingPeriod[] }).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading billing data...</p>;
  if (error) return <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;

  return (
    <div className="space-y-6">
      {/* Current plan */}
      {usage && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>Month-to-date charges and forecast</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge className={TIER_COLORS[usage.tier.tierName] ?? ''}>{usage.tier.tierName}</Badge>
              <Button variant="outline" size="sm">Upgrade</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Charges summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">Base Fee</p>
                <p className="text-lg font-bold">{formatCents(usage.baseChargeCents)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">Usage Charges</p>
                <p className="text-lg font-bold">{formatCents(usage.usageChargeCents)}</p>
              </div>
              <div className="rounded-lg border p-3 text-center bg-muted/30">
                <p className="text-xs text-muted-foreground">MTD Total</p>
                <p className="text-lg font-bold">{formatCents(usage.totalChargeCents)}</p>
              </div>
            </div>
            <div className="text-center text-sm text-muted-foreground">
              Forecasted month-end: <span className="font-semibold text-foreground">{formatCents(usage.forecastedMonthEndCents)}</span>
            </div>

            {/* Usage breakdown */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Usage Breakdown</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
                  <span className="text-muted-foreground">Entities indexed</span>
                  <span className="font-medium">{formatNumber(usage.usageCounts.entity_indexed)}</span>
                </div>
                <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
                  <span className="text-muted-foreground">Queries executed</span>
                  <span className="font-medium">{formatNumber(usage.usageCounts.query_executed)}</span>
                </div>
                <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
                  <span className="text-muted-foreground">Tokens spent</span>
                  <span className="font-medium">{formatNumber(usage.usageCounts.token_spent)}</span>
                </div>
                <div className="flex justify-between rounded bg-muted/30 px-3 py-1.5">
                  <span className="text-muted-foreground">API calls</span>
                  <span className="font-medium">{formatNumber(usage.usageCounts.api_call)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Billing history */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice History</CardTitle>
          <CardDescription>Past billing periods</CardDescription>
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="space-y-2">
              {periods.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border px-4 py-2">
                  <div className="text-sm">
                    <span className="font-medium">
                      {new Date(p.periodStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                    <span className="text-muted-foreground ml-2">{formatCents(p.totalChargesCents)}</span>
                  </div>
                  <Badge className={STATUS_COLORS[p.status] ?? ''}>{p.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
