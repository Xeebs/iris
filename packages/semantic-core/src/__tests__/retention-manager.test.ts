import { describe, it, expect, vi } from 'vitest';
import {
  computeArchivalDate,
  isWithinRecoveryWindow,
  shouldKeepEntity,
  daysUntilRecoveryDeadline,
  RetentionPolicyService,
} from '../retention-manager.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// ─── computeArchivalDate ──────────────────────────────────────────────────────

describe('computeArchivalDate', () => {
  it('adds retention days to creation date', () => {
    const created = new Date(2026, 0, 1); // Jan 1 local time
    const archival = computeArchivalDate(created, 30);
    const diffMs = archival.getTime() - created.getTime();
    expect(diffMs).toBe(30 * 86400000);
  });

  it('adds 1 day correctly', () => {
    const created = new Date(2026, 5, 1); // June 1 local time
    const archival = computeArchivalDate(created, 1);
    const diffMs = archival.getTime() - created.getTime();
    expect(diffMs).toBe(86400000);
  });

  it('returns future date for any positive retention days', () => {
    const now = new Date();
    const archival = computeArchivalDate(now, 90);
    expect(archival.getTime()).toBeGreaterThan(now.getTime());
  });
});

// ─── isWithinRecoveryWindow ───────────────────────────────────────────────────

describe('isWithinRecoveryWindow', () => {
  it('returns true when within window', () => {
    const archived = new Date(Date.now() - 5 * 86400000); // 5 days ago
    expect(isWithinRecoveryWindow(archived, 30)).toBe(true);
  });

  it('returns false when window has expired', () => {
    const archived = new Date(Date.now() - 31 * 86400000); // 31 days ago
    expect(isWithinRecoveryWindow(archived, 30)).toBe(false);
  });

  it('returns true when archived just now', () => {
    const archived = new Date();
    expect(isWithinRecoveryWindow(archived, 30)).toBe(true);
  });
});

// ─── shouldKeepEntity ─────────────────────────────────────────────────────────

describe('shouldKeepEntity', () => {
  it('returns false for empty conditions', () => {
    expect(shouldKeepEntity([], {})).toBe(false);
  });

  it('returns true when entity has matching tag', () => {
    const conditions = [{ field: 'tags', operator: 'has_tag' as const, value: 'vip' }];
    expect(shouldKeepEntity(conditions, { tags: ['vip', 'enterprise'] })).toBe(true);
  });

  it('returns false when entity lacks matching tag', () => {
    const conditions = [{ field: 'tags', operator: 'has_tag' as const, value: 'vip' }];
    expect(shouldKeepEntity(conditions, { tags: ['basic'] })).toBe(false);
  });

  it('returns true when recently accessed', () => {
    const recentAccess = new Date(Date.now() - 2 * 86400000).toISOString();
    const conditions = [{ field: 'last_accessed_at', operator: 'not_accessed_since' as const, value: 7 }];
    expect(shouldKeepEntity(conditions, { last_accessed_at: recentAccess })).toBe(true);
  });

  it('returns false when not recently accessed', () => {
    const oldAccess = new Date(Date.now() - 30 * 86400000).toISOString();
    const conditions = [{ field: 'last_accessed_at', operator: 'not_accessed_since' as const, value: 7 }];
    expect(shouldKeepEntity(conditions, { last_accessed_at: oldAccess })).toBe(false);
  });
});

// ─── daysUntilRecoveryDeadline ────────────────────────────────────────────────

describe('daysUntilRecoveryDeadline', () => {
  it('returns positive number when within window', () => {
    const archived = new Date(Date.now() - 5 * 86400000);
    const days = daysUntilRecoveryDeadline(archived, 30);
    expect(days).toBeCloseTo(25, 0);
  });

  it('returns negative when expired', () => {
    const archived = new Date(Date.now() - 40 * 86400000);
    const days = daysUntilRecoveryDeadline(archived, 30);
    expect(days).toBeLessThan(0);
  });
});

// ─── RetentionPolicyService ───────────────────────────────────────────────────

function makeSql(returnVal: unknown = []) {
  return vi.fn().mockResolvedValue(returnVal) as unknown as ReturnType<typeof import('postgres').default>;
}

describe('RetentionPolicyService.defineRetentionPolicy', () => {
  it('returns ok with policy on success', async () => {
    const svc = new RetentionPolicyService(makeSql([]));
    const result = await svc.defineRetentionPolicy('contact', 365, 'soft_delete', [], 'Keep contacts for 1 year');
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().retentionDays).toBe(365);
  });

  it('propagates db error', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('db error')) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new RetentionPolicyService(sql);
    const result = await svc.defineRetentionPolicy('contact', 365, 'soft_delete');
    expect(result.isErr()).toBe(true);
  });
});

describe('RetentionPolicyService.listRetentionPolicies', () => {
  it('returns empty list when no policies', async () => {
    const svc = new RetentionPolicyService(makeSql([]));
    const result = await svc.listRetentionPolicies();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toHaveLength(0);
  });

  it('maps rows correctly', async () => {
    const rows = [{
      id: 'p1', entity_type: 'contact', retention_days: 365,
      archive_action: 'soft_delete', conditions: '[]', description: 'Test', active: true, created_at: new Date(),
    }];
    const svc = new RetentionPolicyService(makeSql(rows));
    const result = await svc.listRetentionPolicies();
    expect(result._unsafeUnwrap()[0]!.entityType).toBe('contact');
  });
});

describe('RetentionPolicyService.archiveEntity', () => {
  it('archives entity and returns record', async () => {
    const sql = vi.fn()
      .mockResolvedValueOnce([{ type: 'contact' }])
      .mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new RetentionPolicyService(sql);
    const result = await svc.archiveEntity('e1', 'expired', 30);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().entityId).toBe('e1');
    expect(result._unsafeUnwrap().restorable).toBe(true);
  });
});

describe('RetentionPolicyService.restoreArchivedEntity', () => {
  it('returns ok when within recovery window', async () => {
    const archivedAt = new Date(Date.now() - 5 * 86400000);
    const sql = vi.fn()
      .mockResolvedValueOnce([{ archived_at: archivedAt, recovery_window_days: 30 }])
      .mockResolvedValue([]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new RetentionPolicyService(sql);
    const result = await svc.restoreArchivedEntity('e1');
    expect(result.isOk()).toBe(true);
  });

  it('returns err when no archive record found', async () => {
    const svc = new RetentionPolicyService(makeSql([]));
    const result = await svc.restoreArchivedEntity('unknown');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('No archive record');
  });

  it('returns err when recovery window expired', async () => {
    const archivedAt = new Date(Date.now() - 40 * 86400000);
    const sql = vi.fn()
      .mockResolvedValueOnce([{ archived_at: archivedAt, recovery_window_days: 30 }]) as unknown as ReturnType<typeof import('postgres').default>;
    const svc = new RetentionPolicyService(sql);
    const result = await svc.restoreArchivedEntity('e1');
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('expired');
  });
});

describe('RetentionPolicyService.queryArchivedEntities', () => {
  it('returns empty when no archived entities', async () => {
    const svc = new RetentionPolicyService(makeSql([]));
    const result = await svc.queryArchivedEntities();
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().entities).toHaveLength(0);
  });
});
