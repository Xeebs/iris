import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OnboardingManager } from '../onboarding-manager.js';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: 'ws-1',
    status: 'in_progress',
    current_step: 1,
    completed_steps: [],
    industry: null,
    company_size: null,
    completed_at: null,
    ...overrides,
  };
}

function makeSql(returnRows: unknown[] = [makeRow()]) {
  const sql = vi.fn().mockResolvedValue(returnRows) as unknown;
  (sql as Record<string, unknown>).array = vi.fn((v: unknown) => v);
  return sql as ReturnType<typeof import('postgres').default>;
}

describe('OnboardingManager', () => {
  let manager: OnboardingManager;
  let sql: ReturnType<typeof makeSql>;

  beforeEach(() => {
    sql = makeSql();
    manager = new OnboardingManager(sql);
  });

  describe('trackOnboardingStage', () => {
    it('returns ok with mapped status on success', async () => {
      const row = makeRow({ current_step: 2 });
      sql = makeSql([row]);
      manager = new OnboardingManager(sql);

      const result = await manager.trackOnboardingStage('ws-1', 'connector_selection');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.workspaceId).toBe('ws-1');
        expect(result.value.stage).toBe('connector_selection');
        expect(result.value.currentStep).toBe(2);
      }
    });

    it('returns err when db throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB down')) as unknown as ReturnType<typeof makeSql>;
      (sql as unknown as Record<string, unknown>).array = vi.fn();
      manager = new OnboardingManager(sql);

      const result = await manager.trackOnboardingStage('ws-1', 'workspace_setup');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('DB down');
      }
    });

    it('returns err when db returns empty rows', async () => {
      sql = makeSql([]);
      manager = new OnboardingManager(sql);

      const result = await manager.trackOnboardingStage('ws-1', 'workspace_setup');
      expect(result.isErr()).toBe(true);
    });

    it('records stage complete correctly', async () => {
      const row = makeRow({ current_step: 7, status: 'completed', completed_at: new Date('2026-06-08') });
      sql = makeSql([row]);
      manager = new OnboardingManager(sql);

      const result = await manager.trackOnboardingStage('ws-1', 'complete');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.stage).toBe('complete');
        expect(result.value.completedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('getRecommendedConnectors', () => {
    it('returns 5 connectors', () => {
      const recs = manager.getRecommendedConnectors(null, null);
      expect(recs).toHaveLength(5);
    });

    it('returns sales connectors for sales industry', () => {
      const recs = manager.getRecommendedConnectors(null, 'sales');
      expect(recs[0].connectorId).toBe('hubspot');
    });

    it('returns finance connectors for finance industry', () => {
      const recs = manager.getRecommendedConnectors(null, 'finance');
      expect(recs[0].connectorId).toBe('quickbooks');
    });

    it('returns engineering connectors for engineering industry', () => {
      const recs = manager.getRecommendedConnectors(null, 'engineering');
      expect(recs[0].connectorId).toBe('linear');
    });

    it('returns default connectors for unknown industry', () => {
      const recs = manager.getRecommendedConnectors(null, 'aerospace');
      expect(recs[0].connectorId).toBe('notion');
    });

    it('prioritizes notion for small companies (1-10)', () => {
      const recs = manager.getRecommendedConnectors('1-10', 'sales');
      expect(recs[0].connectorId).toBe('notion');
    });

    it('prioritizes notion for small companies (11-50)', () => {
      const recs = manager.getRecommendedConnectors('11-50', 'sales');
      expect(recs[0].connectorId).toBe('notion');
    });

    it('does not reprioritize notion for large companies', () => {
      const recs = manager.getRecommendedConnectors('1000+', 'sales');
      expect(recs[0].connectorId).toBe('hubspot');
    });

    it('includes priority values in ascending order', () => {
      const recs = manager.getRecommendedConnectors(null, 'operations');
      for (let i = 0; i < recs.length - 1; i++) {
        expect(recs[i].priority).toBeLessThanOrEqual(recs[i + 1].priority);
      }
    });

    it('each recommendation has required fields', () => {
      const recs = manager.getRecommendedConnectors(null, 'hr');
      for (const rec of recs) {
        expect(rec.connectorId).toBeTruthy();
        expect(rec.name).toBeTruthy();
        expect(rec.reason).toBeTruthy();
        expect(typeof rec.priority).toBe('number');
      }
    });

    it('handles null industry gracefully', () => {
      const recs = manager.getRecommendedConnectors('51-200', null);
      expect(recs).toHaveLength(5);
    });
  });

  describe('recordCompletionMetrics', () => {
    it('returns ok on success', async () => {
      const result = await manager.recordCompletionMetrics('ws-1', 3, 1500, 120000);
      expect(result.isOk()).toBe(true);
    });

    it('calls sql with correct workspace', async () => {
      await manager.recordCompletionMetrics('ws-2', 2, 800, 60000);
      expect(sql).toHaveBeenCalled();
    });

    it('returns err when db throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB timeout')) as unknown as ReturnType<typeof makeSql>;
      (sql as unknown as Record<string, unknown>).array = vi.fn();
      manager = new OnboardingManager(sql);

      const result = await manager.recordCompletionMetrics('ws-1', 1, 100, 30000);
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toBe('DB timeout');
      }
    });

    it('handles zero entities indexed', async () => {
      const result = await manager.recordCompletionMetrics('ws-1', 0, 0, 0);
      expect(result.isOk()).toBe(true);
    });
  });
});
