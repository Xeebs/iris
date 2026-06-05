import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricRegistry } from '../metrics.js';

const mockSql = vi.fn();

function makeSql() {
  return mockSql as unknown as Parameters<typeof MetricRegistry>[0];
}

const WORKSPACE = 'ws-123';
const FAKE_ROW = {
  id: 'metric-1',
  workspace_id: WORKSPACE,
  name: 'monthly_revenue',
  formula: 'SUM(amount) WHERE period = current_month',
  description: 'Total revenue for the current month',
  created_at: new Date(),
  updated_at: new Date(),
};

describe('MetricRegistry', () => {
  let registry: MetricRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new MetricRegistry(makeSql());
  });

  describe('defineMetric()', () => {
    it('returns ok with the new metric on success', async () => {
      mockSql.mockResolvedValueOnce([FAKE_ROW]);

      const result = await registry.defineMetric(
        WORKSPACE,
        'monthly_revenue',
        'SUM(amount) WHERE period = current_month',
        'Total revenue for the current month',
      );
      expect(result.isOk()).toBe(true);
      const metric = result._unsafeUnwrap();
      expect(metric.name).toBe('monthly_revenue');
      expect(metric.formula).toBe('SUM(amount) WHERE period = current_month');
    });

    it('returns err when DB throws', async () => {
      mockSql.mockRejectedValueOnce(new Error('DB down'));
      const result = await registry.defineMetric(WORKSPACE, 'foo', 'formula', 'desc');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB down');
    });

    it('returns err when no row returned', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await registry.defineMetric(WORKSPACE, 'foo', 'formula', 'desc');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getMetric()', () => {
    it('returns ok with metric when found', async () => {
      mockSql.mockResolvedValueOnce([FAKE_ROW]);
      const result = await registry.getMetric(WORKSPACE, 'monthly_revenue');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.name).toBe('monthly_revenue');
    });

    it('returns ok with null when not found', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await registry.getMetric(WORKSPACE, 'unknown');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns err on DB failure', async () => {
      mockSql.mockRejectedValueOnce(new Error('timeout'));
      const result = await registry.getMetric(WORKSPACE, 'monthly_revenue');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listMetrics()', () => {
    it('returns all metrics for workspace', async () => {
      const rows = [
        FAKE_ROW,
        { ...FAKE_ROW, id: 'metric-2', name: 'churn_rate', formula: 'churned / total', description: 'Churn rate' },
      ];
      mockSql.mockResolvedValueOnce(rows);

      const result = await registry.listMetrics(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('returns empty array when no metrics defined', async () => {
      mockSql.mockResolvedValueOnce([]);
      const result = await registry.listMetrics(WORKSPACE);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('deleteMetric()', () => {
    it('returns ok true when metric deleted', async () => {
      mockSql.mockResolvedValueOnce({ count: 1 });
      const result = await registry.deleteMetric(WORKSPACE, 'monthly_revenue');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(true);
    });

    it('returns ok false when metric not found', async () => {
      mockSql.mockResolvedValueOnce({ count: 0 });
      const result = await registry.deleteMetric(WORKSPACE, 'nonexistent');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(false);
    });
  });
});
