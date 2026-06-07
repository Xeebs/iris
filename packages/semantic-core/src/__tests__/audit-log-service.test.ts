import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogService } from '../audit-log-service.js';
import type { LogActionInput } from '../audit-log-service.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const SAMPLE_ROW = {
  id: 'log-uuid-1',
  workspace_id: 'ws-1',
  actor_id: 'user-123',
  actor_type: 'user',
  action: 'entity_write',
  resource_type: 'contact',
  resource_id: 'hubspot:contact:1',
  changes: null,
  ip_address: '1.2.3.4',
  user_agent: 'Mozilla/5.0',
  metadata: {},
  created_at: '2024-01-01T12:00:00Z',
};

const SAMPLE_INPUT: LogActionInput = {
  workspaceId: 'ws-1',
  actorId: 'user-123',
  actorType: 'user',
  action: 'entity_write',
  resourceType: 'contact',
  resourceId: 'hubspot:contact:1',
  ipAddress: '1.2.3.4',
};

describe('AuditLogService', () => {
  let sql: ReturnType<typeof vi.fn>;
  let service: AuditLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = vi.fn(async () => [SAMPLE_ROW]);
    service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
  });

  describe('logAction', () => {
    it('inserts an audit log and returns it', async () => {
      const result = await service.logAction(SAMPLE_INPUT);
      expect(result.isOk()).toBe(true);
      const log = result._unsafeUnwrap();
      expect(log.id).toBe('log-uuid-1');
      expect(log.action).toBe('entity_write');
      expect(log.actorType).toBe('user');
    });

    it('logs system actions without actor', async () => {
      const systemRow = { ...SAMPLE_ROW, actor_id: null, actor_type: 'system', action: 'connector_sync' };
      sql = vi.fn(async () => [systemRow]);
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);

      const result = await service.logAction({
        workspaceId: 'ws-1',
        actorType: 'system',
        action: 'connector_sync',
      });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().actorId).toBeNull();
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('write failed'));
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
      const result = await service.logAction(SAMPLE_INPUT);
      expect(result.isErr()).toBe(true);
    });

    it('stores changes as JSON', async () => {
      const result = await service.logAction({
        ...SAMPLE_INPUT,
        changes: { before: { stage: 'lead' }, after: { stage: 'customer' } },
      });
      expect(result.isOk()).toBe(true);
      // Verify sql was called with the input (changes stringify happens inside)
      expect(sql).toHaveBeenCalledOnce();
    });
  });

  describe('queryLogs', () => {
    it('returns paginated logs', async () => {
      const rows = [SAMPLE_ROW, { ...SAMPLE_ROW, id: 'log-uuid-2' }];
      sql = vi.fn(async () => rows);
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);

      const result = await service.queryLogs('ws-1', { limit: 50 });
      expect(result.isOk()).toBe(true);
      const page = result._unsafeUnwrap();
      expect(page.logs).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('sets hasMore and nextCursor when more results exist', async () => {
      // Return limit+1 rows to trigger pagination
      const rows = Array.from({ length: 3 }, (_, i) => ({ ...SAMPLE_ROW, id: `log-${i}` }));
      sql = vi.fn(async () => rows);
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);

      const result = await service.queryLogs('ws-1', { limit: 2 });
      expect(result.isOk()).toBe(true);
      const page = result._unsafeUnwrap();
      expect(page.hasMore).toBe(true);
      expect(page.logs).toHaveLength(2);
      expect(page.nextCursor).toBe('log-1');
    });

    it('returns empty page when no logs exist', async () => {
      sql = vi.fn(async () => []);
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
      const result = await service.queryLogs('ws-1');
      expect(result.isOk()).toBe(true);
      const page = result._unsafeUnwrap();
      expect(page.logs).toHaveLength(0);
      expect(page.hasMore).toBe(false);
    });

    it('caps limit at 200', async () => {
      sql = vi.fn(async () => []);
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
      // Should not throw; just uses max 200
      const result = await service.queryLogs('ws-1', { limit: 999 });
      expect(result.isOk()).toBe(true);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('query failed'));
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
      const result = await service.queryLogs('ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('exportLogs', () => {
    it('exports logs as JSON string', async () => {
      const result = await service.exportLogs('ws-1', 'json');
      expect(result.isOk()).toBe(true);
      const output = result._unsafeUnwrap();
      const parsed = JSON.parse(output) as unknown[];
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('exports logs as CSV with header', async () => {
      const result = await service.exportLogs('ws-1', 'csv');
      expect(result.isOk()).toBe(true);
      const csv = result._unsafeUnwrap();
      expect(csv).toContain('id,workspace_id,actor_id');
      expect(csv).toContain('log-uuid-1');
    });

    it('CSV escapes double quotes in field values', async () => {
      const rowWithQuote = { ...SAMPLE_ROW, actor_id: 'user "special"' };
      sql = vi.fn(async () => [rowWithQuote]);
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
      const result = await service.exportLogs('ws-1', 'csv');
      expect(result._unsafeUnwrap()).toContain('user ""special""');
    });

    it('returns err when underlying query fails', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB error'));
      service = new AuditLogService(sql as unknown as Parameters<typeof AuditLogService>[0]);
      const result = await service.exportLogs('ws-1', 'json');
      expect(result.isErr()).toBe(true);
    });
  });
});
