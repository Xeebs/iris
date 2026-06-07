import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingMeter } from '../billing-meter.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const STARTER_TIER = {
  tier_name: 'starter',
  monthly_base_cents: 0,
  entity_index_price_cents: 0,
  query_price_cents: 0,
  included_tokens: 500000,
};

const GROWTH_TIER = {
  tier_name: 'growth',
  monthly_base_cents: 4900,
  entity_index_price_cents: 1,
  query_price_cents: 5,
  included_tokens: 5000000,
};

const PERIOD_ROW = {
  id: 'period-1',
  workspace_id: 'ws-1',
  period_start: '2026-06-01T00:00:00Z',
  period_end: '2026-06-30T23:59:59Z',
  total_charges_cents: 4900,
  status: 'invoiced',
  created_at: '2026-06-01T00:00:00Z',
};

function makeService(sql: ReturnType<typeof vi.fn>) {
  return new BillingMeter(sql as unknown as ConstructorParameters<typeof BillingMeter>[0]);
}

describe('BillingMeter', () => {
  let sql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordUsage', () => {
    it('inserts a usage event with correct unit price', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [GROWTH_TIER]; // tier lookup
        return []; // INSERT
      });
      const svc = makeService(sql);
      const result = await svc.recordUsage('ws-1', 'query_executed', 3);
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledTimes(2);
    });

    it('defaults unit price to 0 for token_spent on starter tier', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [STARTER_TIER];
        return [];
      });
      const svc = makeService(sql);
      const result = await svc.recordUsage('ws-1', 'token_spent', 1000);
      expect(result.isOk()).toBe(true);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.recordUsage('ws-1', 'entity_indexed');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getWorkspaceTier', () => {
    it('returns workspace tier when billing record exists', async () => {
      sql = vi.fn(async () => [GROWTH_TIER]);
      const svc = makeService(sql);
      const result = await svc.getWorkspaceTier('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().tierName).toBe('growth');
      expect(result._unsafeUnwrap().monthlyBaseCents).toBe(4900);
    });

    it('falls back to starter tier when no billing record', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return []; // no workspace_billing row
        return [STARTER_TIER]; // default starter lookup
      });
      const svc = makeService(sql);
      const result = await svc.getWorkspaceTier('ws-unknown');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().tierName).toBe('starter');
    });
  });

  describe('calculateCharges', () => {
    it('calculates base + usage charges correctly', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [GROWTH_TIER]; // getWorkspaceTier → workspace_billing
        if (call === 2) return [
          { event_type: 'query_executed', total_qty: '100', total_cents: '500' },
          { event_type: 'entity_indexed', total_qty: '200', total_cents: '200' },
        ];
        return [];
      });
      const svc = makeService(sql);
      const result = await svc.calculateCharges(
        'ws-1',
        new Date('2026-06-01'),
        new Date('2026-06-07'),
      );
      expect(result.isOk()).toBe(true);
      const summary = result._unsafeUnwrap();
      expect(summary.baseChargeCents).toBe(4900);
      expect(summary.usageChargeCents).toBe(700); // 500 + 200
      expect(summary.totalChargeCents).toBe(5600);
    });

    it('returns zero usage charges for starter tier with no events', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [STARTER_TIER];
        return []; // no usage events
      });
      const svc = makeService(sql);
      const result = await svc.calculateCharges('ws-1', new Date('2026-06-01'), new Date('2026-06-30'));
      expect(result.isOk()).toBe(true);
      const summary = result._unsafeUnwrap();
      expect(summary.totalChargeCents).toBe(0);
      expect(summary.usageCounts.entity_indexed).toBe(0);
    });

    it('returns err when getWorkspaceTier fails', async () => {
      sql = vi.fn().mockRejectedValue(new Error('db error'));
      const svc = makeService(sql);
      const result = await svc.calculateCharges('ws-1', new Date(), new Date());
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listPeriods', () => {
    it('returns billing periods for workspace', async () => {
      sql = vi.fn(async () => [PERIOD_ROW]);
      const svc = makeService(sql);
      const result = await svc.listPeriods('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()[0]!.status).toBe('invoiced');
      expect(result._unsafeUnwrap()[0]!.totalChargesCents).toBe(4900);
    });
  });

  describe('closePeriod', () => {
    it('inserts a billing period record', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [GROWTH_TIER]; // getWorkspaceTier
        if (call === 2) return []; // usage events (empty)
        return [PERIOD_ROW]; // INSERT
      });
      const svc = makeService(sql);
      const result = await svc.closePeriod('ws-1', new Date('2026-06-01'), new Date('2026-06-30'));
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().status).toBe('invoiced');
    });

    it('returns err when period already exists (no rows returned)', async () => {
      let call = 0;
      sql = vi.fn(async () => {
        call++;
        if (call === 1) return [STARTER_TIER];
        if (call === 2) return [];
        return []; // ON CONFLICT DO NOTHING → no rows
      });
      const svc = makeService(sql);
      const result = await svc.closePeriod('ws-1', new Date('2026-06-01'), new Date('2026-06-30'));
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('already exists');
    });
  });
});
