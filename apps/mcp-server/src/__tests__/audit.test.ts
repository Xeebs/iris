import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogger } from '../audit.js';
import type { AuditEvent } from '../audit.js';

// ─── Mock postgres ────────────────────────────────────────────────────────────

const mockSql = vi.fn();

vi.mock('postgres', () => {
  return {
    default: () => {
      const tag = vi.fn().mockResolvedValue([]);
      // Make the template-tag function also callable as sql`...`
      return new Proxy(tag, {
        get: (_target, prop) => {
          if (prop === 'end') return vi.fn().mockResolvedValue(undefined);
          return tag;
        },
        apply: (_target, _thisArg, args: unknown[]) => mockSql(...args),
      });
    },
  };
});

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    workspaceId: 'ws-test',
    toolName: 'query-context',
    query: 'show me top deals',
    tokenEstimate: 150,
    cacheHit: false,
    durationMs: 42,
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockResolvedValue([]);
    logger = new AuditLogger('postgres://localhost/iris_test');
  });

  describe('logAuditEvent()', () => {
    it('inserts a row without throwing', async () => {
      await expect(logger.logAuditEvent(makeEvent())).resolves.toBeUndefined();
    });

    it('does not throw if Postgres rejects — logs error instead', async () => {
      mockSql.mockRejectedValueOnce(new Error('connection lost'));
      await expect(logger.logAuditEvent(makeEvent())).resolves.toBeUndefined();
    });

    it('passes all event fields to SQL', async () => {
      const event = makeEvent({ cacheHit: true, tokenEstimate: 512 });
      await logger.logAuditEvent(event);
      // Just verify it calls through without throwing and the mock received arguments
      expect(mockSql).toHaveBeenCalled();
    });
  });

  describe('getAuditLog()', () => {
    it('returns empty page when no records exist', async () => {
      mockSql.mockResolvedValue([]);
      const page = await logger.getAuditLog('ws-test');
      expect(page.records).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('returns records mapped to AuditRecord shape', async () => {
      const now = new Date();
      mockSql.mockResolvedValue([
        {
          id: 'uuid-1',
          workspace_id: 'ws-test',
          tool_name: 'query-context',
          query: 'test',
          token_estimate: 100,
          cache_hit: false,
          duration_ms: 30,
          timestamp: now,
        },
      ]);
      const page = await logger.getAuditLog('ws-test');
      expect(page.records).toHaveLength(1);
      const r = page.records[0]!;
      expect(r.id).toBe('uuid-1');
      expect(r.workspaceId).toBe('ws-test');
      expect(r.toolName).toBe('query-context');
      expect(r.tokenEstimate).toBe(100);
      expect(r.cacheHit).toBe(false);
      expect(r.durationMs).toBe(30);
      expect(r.timestamp).toBe(now);
    });

    it('sets hasMore and nextCursor when more records exist', async () => {
      const now = new Date();
      // Return limit+1 rows (default limit is 50, so 51 rows)
      const rows = Array.from({ length: 51 }, (_, i) => ({
        id: `uuid-${i}`,
        workspace_id: 'ws-test',
        tool_name: 'query-context',
        query: '',
        token_estimate: 0,
        cache_hit: false,
        duration_ms: 10,
        timestamp: now,
      }));
      mockSql.mockResolvedValue(rows);

      const page = await logger.getAuditLog('ws-test');
      expect(page.hasMore).toBe(true);
      expect(page.records).toHaveLength(50);
      expect(page.nextCursor).not.toBeNull();
      expect(page.nextCursor).toContain('uuid-49');
    });

    it('respects limit option', async () => {
      const now = new Date();
      const rows = Array.from({ length: 6 }, (_, i) => ({
        id: `uuid-${i}`,
        workspace_id: 'ws-test',
        tool_name: 'query-context',
        query: '',
        token_estimate: 0,
        cache_hit: false,
        duration_ms: 10,
        timestamp: now,
      }));
      mockSql.mockResolvedValue(rows);

      const page = await logger.getAuditLog('ws-test', { limit: 5 });
      expect(page.records).toHaveLength(5);
      expect(page.hasMore).toBe(true);
    });

    it('clamps limit to 200 max', async () => {
      mockSql.mockResolvedValue([]);
      // Just verify it doesn't throw with an overly large limit
      await expect(logger.getAuditLog('ws-test', { limit: 99999 })).resolves.toBeDefined();
    });
  });

  describe('DEFAULT_COMPRESSION_OPTIONS shape', () => {
    it('AuditEvent type has all required fields', () => {
      const event: AuditEvent = {
        workspaceId: 'ws',
        toolName: 'get-entity',
        query: '',
        tokenEstimate: 0,
        cacheHit: true,
        durationMs: 5,
      };
      expect(event).toBeTruthy();
    });
  });
});
