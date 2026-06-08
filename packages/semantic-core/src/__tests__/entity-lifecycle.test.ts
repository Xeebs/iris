import { describe, it, expect, vi } from 'vitest';
import {
  isValidTransition,
  computeHealthScore,
  isAtRisk,
  EntityLifecycleManager,
} from '../entity-lifecycle.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── isValidTransition ────────────────────────────────────────────────────────

describe('isValidTransition', () => {
  it('allows DRAFT → PUBLISHED', () => expect(isValidTransition('DRAFT', 'PUBLISHED')).toBe(true));
  it('allows DRAFT → ARCHIVED', () => expect(isValidTransition('DRAFT', 'ARCHIVED')).toBe(true));
  it('allows PUBLISHED → DEPRECATED', () => expect(isValidTransition('PUBLISHED', 'DEPRECATED')).toBe(true));
  it('allows PUBLISHED → ARCHIVED', () => expect(isValidTransition('PUBLISHED', 'ARCHIVED')).toBe(true));
  it('allows DEPRECATED → PUBLISHED (undo)', () => expect(isValidTransition('DEPRECATED', 'PUBLISHED')).toBe(true));
  it('allows DEPRECATED → ARCHIVED', () => expect(isValidTransition('DEPRECATED', 'ARCHIVED')).toBe(true));
  it('rejects ARCHIVED → PUBLISHED (terminal state)', () => expect(isValidTransition('ARCHIVED', 'PUBLISHED')).toBe(false));
  it('rejects ARCHIVED → DEPRECATED', () => expect(isValidTransition('ARCHIVED', 'DEPRECATED')).toBe(false));
  it('rejects PUBLISHED → DRAFT (backwards)', () => expect(isValidTransition('PUBLISHED', 'DRAFT')).toBe(false));
});

// ─── computeHealthScore ───────────────────────────────────────────────────────

describe('computeHealthScore', () => {
  it('returns high score for fresh published entity with approvals', () => {
    const result = computeHealthScore(0, 3, 'PUBLISHED');
    expect(result.score).toBeGreaterThan(80);
  });

  it('returns lower score for stale entity', () => {
    const fresh = computeHealthScore(0, 2, 'PUBLISHED');
    const stale = computeHealthScore(180, 2, 'PUBLISHED');
    expect(fresh.score).toBeGreaterThan(stale.score);
  });

  it('returns lower score for deprecated entity', () => {
    const published = computeHealthScore(10, 2, 'PUBLISHED');
    const deprecated = computeHealthScore(10, 2, 'DEPRECATED');
    expect(published.score).toBeGreaterThan(deprecated.score);
  });

  it('score is between 0 and 100', () => {
    const extremes = [
      computeHealthScore(0, 5, 'PUBLISHED'),
      computeHealthScore(365, 0, 'ARCHIVED'),
      computeHealthScore(200, 0, 'DEPRECATED'),
    ];
    for (const r of extremes) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it('approvals are capped at 40 points contribution', () => {
    const three = computeHealthScore(0, 3, 'DRAFT');
    const ten = computeHealthScore(0, 10, 'DRAFT');
    // Both should have max approval factor
    expect(ten.approvalFactor).toBe(three.approvalFactor);
  });

  it('includes breakdown with recency, approval, status keys', () => {
    const result = computeHealthScore(30, 2, 'PUBLISHED');
    expect(result.breakdown).toHaveProperty('recency');
    expect(result.breakdown).toHaveProperty('approval');
    expect(result.breakdown).toHaveProperty('status');
  });
});

// ─── isAtRisk ─────────────────────────────────────────────────────────────────

describe('isAtRisk', () => {
  it('published with 0 approvals is at risk', () => expect(isAtRisk('PUBLISHED', 10, 0)).toBe(true));
  it('published and stale (>90 days) is at risk', () => expect(isAtRisk('PUBLISHED', 91, 2)).toBe(true));
  it('published with approvals and fresh is not at risk', () => expect(isAtRisk('PUBLISHED', 30, 1)).toBe(false));
  it('DRAFT is never at risk', () => expect(isAtRisk('DRAFT', 100, 0)).toBe(false));
  it('DEPRECATED is never at risk', () => expect(isAtRisk('DEPRECATED', 100, 0)).toBe(false));
  it('ARCHIVED is never at risk', () => expect(isAtRisk('ARCHIVED', 365, 0)).toBe(false));
});

// ─── EntityLifecycleManager ───────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('EntityLifecycleManager.defineEntityStatus', () => {
  it('allows first-time status set (no existing state)', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.defineEntityStatus('e1', 'DRAFT', 'Initial', 'admin');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().toStatus).toBe('DRAFT');
  });

  it('allows valid transition', async () => {
    let call = 0;
    const sql = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([{ current_status: 'DRAFT' }]);
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.defineEntityStatus('e1', 'PUBLISHED', 'Ready', 'admin');
    expect(result.isOk()).toBe(true);
  });

  it('rejects invalid transition', async () => {
    const sql = vi.fn().mockResolvedValue([{ current_status: 'ARCHIVED' }]) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.defineEntityStatus('e1', 'PUBLISHED', 'Try to revive', 'admin');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid transition');
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db down')) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.defineEntityStatus('e1', 'DRAFT', 'test', 'admin');
    expect(result.isErr()).toBe(true);
  });
});

describe('EntityLifecycleManager.trackStatusHistory', () => {
  it('returns mapped history events', async () => {
    const sql = makeSql([
      { id: 'ev1', entity_id: 'e1', from_status: 'DRAFT', to_status: 'PUBLISHED', reason: 'ready', actor: 'admin', metadata: {}, occurred_at: new Date() },
    ]);
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.trackStatusHistory('e1');
    expect(result.isOk()).toBe(true);
    const events = result._unsafeUnwrap();
    expect(events).toHaveLength(1);
    expect(events[0]!.toStatus).toBe('PUBLISHED');
    expect(events[0]!.fromStatus).toBe('DRAFT');
  });

  it('returns empty for entity with no history', async () => {
    const sql = makeSql([]);
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.trackStatusHistory('e1');
    expect(result._unsafeUnwrap()).toEqual([]);
  });
});

describe('EntityLifecycleManager.approveEntity', () => {
  it('returns ok approval', async () => {
    const sql = makeSql([]);
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.approveEntity('e1', 'approver-1', 'requires legal review');
    expect(result.isOk()).toBe(true);
    const approval = result._unsafeUnwrap();
    expect(approval.approverId).toBe('approver-1');
    expect(approval.conditions).toBe('requires legal review');
  });

  it('null conditions are allowed', async () => {
    const sql = makeSql([]);
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.approveEntity('e1', 'approver-1');
    expect(result._unsafeUnwrap().conditions).toBeNull();
  });
});

describe('EntityLifecycleManager.deprecateEntity', () => {
  it('transitions to DEPRECATED with replacement', async () => {
    let call = 0;
    const sql = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([]); // UPDATE replacement
      if (call === 2) return Promise.resolve([{ current_status: 'PUBLISHED' }]); // get existing
      return Promise.resolve([]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.deprecateEntity('e1', 'admin', 'e2', new Date('2027-01-01'));
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().toStatus).toBe('DEPRECATED');
  });
});

describe('EntityLifecycleManager.computeEntityHealthScore', () => {
  it('returns score for existing entity', async () => {
    const sql = makeSql([{
      current_status: 'PUBLISHED',
      last_transition_at: new Date(Date.now() - 30 * 86_400_000),
      approval_count: 2,
    }]);
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.computeEntityHealthScore('e1');
    expect(result.isOk()).toBe(true);
    const score = result._unsafeUnwrap();
    expect(score.entityId).toBe('e1');
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThanOrEqual(100);
  });

  it('returns err for unknown entity', async () => {
    const sql = makeSql([]);
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.computeEntityHealthScore('unknown');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('not found');
  });
});

describe('EntityLifecycleManager.getLifecycleDashboard', () => {
  it('returns dashboard with status totals', async () => {
    let call = 0;
    const sql = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve([
        { current_status: 'PUBLISHED', count: 10 },
        { current_status: 'DEPRECATED', count: 3 },
      ]);
      return Promise.resolve([{ entity_id: 'e1' }, { entity_id: 'e2' }]);
    }) as unknown as ReturnType<typeof import('postgres').default>;
    const mgr = new EntityLifecycleManager(sql);
    const result = await mgr.getLifecycleDashboard();
    expect(result.isOk()).toBe(true);
    const dash = result._unsafeUnwrap();
    expect(dash.totalByStatus.PUBLISHED).toBe(10);
    expect(dash.totalByStatus.DEPRECATED).toBe(3);
    expect(dash.totalByStatus.DRAFT).toBe(0);
    expect(dash.pendingApprovals).toBe(2);
    expect(dash.atRiskEntities).toContain('e1');
  });
});
