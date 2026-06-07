import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';

import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'billing-meter' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

// ─── Types ────────────────────────────────────────────────────────────────────

export type UsageEventType = 'entity_indexed' | 'query_executed' | 'token_spent' | 'api_call';
export type BillingTierName = 'starter' | 'growth' | 'enterprise';
export type BillingPeriodStatus = 'open' | 'invoiced' | 'paid';

export type BillingTier = {
  tierName: BillingTierName;
  monthlyBaseCents: number;
  entityIndexPriceCents: number;
  queryPriceCents: number;
  includedTokens: number;
};

export type UsageSummary = {
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
  tier: BillingTier;
  usageCounts: Record<UsageEventType, number>;
  baseChargeCents: number;
  usageChargeCents: number;
  totalChargeCents: number;
  forecastedMonthEndCents: number;
};

export type BillingPeriod = {
  id: string;
  workspaceId: string;
  periodStart: Date;
  periodEnd: Date;
  totalChargesCents: number;
  status: BillingPeriodStatus;
  createdAt: Date;
};

// ─── BillingMeter ─────────────────────────────────────────────────────────────

/**
 * Records usage events and computes billing charges per workspace.
 * Prices are applied based on the workspace's current billing tier.
 */
export class BillingMeter {
  constructor(private readonly sql: SqlFn) {}

  /**
   * Record a metered usage event for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param eventType - Type of usage event
   * @param quantity - Units consumed (default: 1)
   */
  async recordUsage(
    workspaceId: string,
    eventType: UsageEventType,
    quantity = 1,
  ): Promise<Result<void, Error>> {
    try {
      const tierRows = await this.sql`
        SELECT bt.entity_index_price_cents, bt.query_price_cents
        FROM workspace_billing wb
        JOIN billing_tiers bt ON wb.tier_name = bt.tier_name
        WHERE wb.workspace_id = ${workspaceId}
      ` as { entity_index_price_cents: number; query_price_cents: number }[];

      const tier = tierRows[0] ?? { entity_index_price_cents: 0, query_price_cents: 0 };
      const unitPriceCents = eventType === 'entity_indexed'
        ? tier.entity_index_price_cents
        : eventType === 'query_executed'
          ? tier.query_price_cents
          : 0;

      await this.sql`
        INSERT INTO usage_events (workspace_id, event_type, quantity, unit_price_cents)
        VALUES (${workspaceId}, ${eventType}, ${quantity}, ${unitPriceCents})
      `;
      return ok(undefined);
    } catch (e) {
      log.warn('Failed to record usage event', { workspaceId, eventType, error: String(e) });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Get the workspace's current billing tier.
   *
   * @param workspaceId - Tenant workspace
   * @returns Tier details, defaults to 'starter' if not configured
   */
  async getWorkspaceTier(workspaceId: string): Promise<Result<BillingTier, Error>> {
    try {
      const rows = await this.sql`
        SELECT bt.tier_name, bt.monthly_base_cents, bt.entity_index_price_cents,
               bt.query_price_cents, bt.included_tokens
        FROM workspace_billing wb
        JOIN billing_tiers bt ON wb.tier_name = bt.tier_name
        WHERE wb.workspace_id = ${workspaceId}
      ` as Record<string, unknown>[];

      if (rows.length > 0) {
        return ok(mapTierRow(rows[0]!));
      }

      // Default to starter tier
      const defaultRows = await this.sql`
        SELECT tier_name, monthly_base_cents, entity_index_price_cents,
               query_price_cents, included_tokens
        FROM billing_tiers WHERE tier_name = 'starter'
      ` as Record<string, unknown>[];
      return ok(mapTierRow(defaultRows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Calculate total charges for a workspace over a billing period.
   *
   * @param workspaceId - Tenant workspace
   * @param periodStart - Period start (inclusive)
   * @param periodEnd - Period end (inclusive)
   * @returns Itemized charge breakdown with forecast
   */
  async calculateCharges(
    workspaceId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Result<UsageSummary, Error>> {
    try {
      const tierResult = await this.getWorkspaceTier(workspaceId);
      if (tierResult.isErr()) return err(tierResult.error);
      const tier = tierResult.value;

      const usageRows = await this.sql`
        SELECT event_type, SUM(quantity)::bigint AS total_qty, SUM(quantity * unit_price_cents)::bigint AS total_cents
        FROM usage_events
        WHERE workspace_id = ${workspaceId}
          AND recorded_at >= ${periodStart.toISOString()}
          AND recorded_at <= ${periodEnd.toISOString()}
        GROUP BY event_type
      ` as { event_type: UsageEventType; total_qty: string; total_cents: string }[];

      const usageCounts: Record<UsageEventType, number> = {
        entity_indexed: 0,
        query_executed: 0,
        token_spent: 0,
        api_call: 0,
      };
      let usageChargeCents = 0;
      for (const r of usageRows) {
        usageCounts[r.event_type] = Number(r.total_qty);
        usageChargeCents += Number(r.total_cents);
      }

      const baseChargeCents = tier.monthlyBaseCents;
      const totalChargeCents = baseChargeCents + usageChargeCents;

      // Forecast: extrapolate current usage to end of month
      const daysElapsed = Math.max(1, (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysInMonth = 30;
      const forecastedMonthEndCents = Math.round((totalChargeCents / daysElapsed) * daysInMonth);

      return ok({
        workspaceId,
        periodStart,
        periodEnd,
        tier,
        usageCounts,
        baseChargeCents,
        usageChargeCents,
        totalChargeCents,
        forecastedMonthEndCents,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List billing periods for a workspace.
   *
   * @param workspaceId - Tenant workspace
   * @param limit - Maximum results (default: 12)
   */
  async listPeriods(workspaceId: string, limit = 12): Promise<Result<BillingPeriod[], Error>> {
    try {
      const rows = await this.sql`
        SELECT id, workspace_id, period_start, period_end, total_charges_cents, status, created_at
        FROM billing_periods
        WHERE workspace_id = ${workspaceId}
        ORDER BY period_start DESC
        LIMIT ${limit}
      ` as Record<string, unknown>[];
      return ok(rows.map(mapPeriodRow));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Finalize an open billing period by computing charges and marking it 'invoiced'.
   *
   * @param workspaceId - Tenant workspace
   * @param periodStart - Start of the period to close
   * @param periodEnd - End of the period to close
   */
  async closePeriod(
    workspaceId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Result<BillingPeriod, Error>> {
    try {
      const summaryResult = await this.calculateCharges(workspaceId, periodStart, periodEnd);
      if (summaryResult.isErr()) return err(summaryResult.error);
      const summary = summaryResult.value;

      const rows = await this.sql`
        INSERT INTO billing_periods (workspace_id, period_start, period_end, total_charges_cents, status)
        VALUES (${workspaceId}, ${periodStart.toISOString()}, ${periodEnd.toISOString()}, ${summary.totalChargeCents}, 'invoiced')
        ON CONFLICT DO NOTHING
        RETURNING id, workspace_id, period_start, period_end, total_charges_cents, status, created_at
      ` as Record<string, unknown>[];

      if (rows.length === 0) return err(new Error('Period already exists'));
      log.info('Billing period closed', { workspaceId, totalChargeCents: summary.totalChargeCents });
      return ok(mapPeriodRow(rows[0]!));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

function mapTierRow(r: Record<string, unknown>): BillingTier {
  return {
    tierName: r['tier_name'] as BillingTierName,
    monthlyBaseCents: r['monthly_base_cents'] as number,
    entityIndexPriceCents: r['entity_index_price_cents'] as number,
    queryPriceCents: r['query_price_cents'] as number,
    includedTokens: Number(r['included_tokens']),
  };
}

function mapPeriodRow(r: Record<string, unknown>): BillingPeriod {
  return {
    id: r['id'] as string,
    workspaceId: r['workspace_id'] as string,
    periodStart: new Date(r['period_start'] as string),
    periodEnd: new Date(r['period_end'] as string),
    totalChargesCents: Number(r['total_charges_cents']),
    status: r['status'] as BillingPeriodStatus,
    createdAt: new Date(r['created_at'] as string),
  };
}
