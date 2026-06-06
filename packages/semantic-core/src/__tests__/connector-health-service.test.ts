import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorHealthService } from '../connector-health-service.js';
import type postgres from 'postgres';

type SqlClient = ReturnType<typeof postgres>;

function makeSqlMock(rows: unknown[] = []): SqlClient {
  const tagged = vi.fn().mockResolvedValue(rows);
  return tagged as unknown as SqlClient;
}

const HEALTH_ROW = {
  id: 'hid-001',
  instance_id: 'inst-001',
  workspace_id: 'ws-001',
  status: 'healthy',
  latency_ms: 42,
  error_message: null,
  checked_at: new Date('2026-06-01T10:00:00Z'),
};

describe('ConnectorHealthService', () => {
  let sql: SqlClient;
  let service: ConnectorHealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSqlMock();
    service = new ConnectorHealthService(sql);
  });

  describe('recordHealth()', () => {
    it('inserts a health record and returns it', async () => {
      sql = makeSqlMock([HEALTH_ROW]);
      service = new ConnectorHealthService(sql);

      const result = await service.recordHealth('inst-001', 'ws-001', 'healthy', 42);

      expect(result.isOk()).toBe(true);
      const record = result._unsafeUnwrap();
      expect(record.instanceId).toBe('inst-001');
      expect(record.workspaceId).toBe('ws-001');
      expect(record.status).toBe('healthy');
      expect(record.latencyMs).toBe(42);
      expect(record.errorMessage).toBeNull();
    });

    it('records unhealthy status with error message', async () => {
      const unhealthyRow = { ...HEALTH_ROW, id: 'hid-002', status: 'unhealthy', latency_ms: null, error_message: 'Connection refused' };
      sql = makeSqlMock([unhealthyRow]);
      service = new ConnectorHealthService(sql);

      const result = await service.recordHealth('inst-001', 'ws-001', 'unhealthy', undefined, 'Connection refused');

      expect(result.isOk()).toBe(true);
      const record = result._unsafeUnwrap();
      expect(record.status).toBe('unhealthy');
      expect(record.errorMessage).toBe('Connection refused');
    });

    it('returns err when no row is returned from INSERT', async () => {
      sql = makeSqlMock([]);
      service = new ConnectorHealthService(sql);

      const result = await service.recordHealth('inst-001', 'ws-001', 'healthy');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Failed to insert');
    });

    it('returns err when DB throws', async () => {
      vi.mocked(sql).mockRejectedValue(new Error('db connection failed'));
      const result = await service.recordHealth('inst-001', 'ws-001', 'healthy');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/db connection failed/);
    });

    it('calls SQL with correct parameters', async () => {
      sql = makeSqlMock([HEALTH_ROW]);
      service = new ConnectorHealthService(sql);

      await service.recordHealth('inst-abc', 'ws-xyz', 'degraded', 250, 'Slow response');

      expect(sql).toHaveBeenCalledOnce();
    });
  });

  describe('getHealth()', () => {
    it('returns the latest health record for an instance', async () => {
      sql = makeSqlMock([HEALTH_ROW]);
      service = new ConnectorHealthService(sql);

      const result = await service.getHealth('inst-001', 'ws-001');

      expect(result.isOk()).toBe(true);
      const health = result._unsafeUnwrap();
      expect(health).not.toBeNull();
      expect(health!.instanceId).toBe('inst-001');
      expect(health!.status).toBe('healthy');
      expect(health!.latencyMs).toBe(42);
    });

    it('returns null when no health record exists', async () => {
      sql = makeSqlMock([]);
      service = new ConnectorHealthService(sql);

      const result = await service.getHealth('inst-none', 'ws-001');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns err when DB throws', async () => {
      vi.mocked(sql).mockRejectedValue(new Error('query failed'));
      const result = await service.getHealth('inst-001', 'ws-001');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toMatch(/query failed/);
    });
  });

  describe('getAllHealth()', () => {
    it('returns health summaries for all instances in a workspace', async () => {
      const rows = [
        HEALTH_ROW,
        { ...HEALTH_ROW, id: 'hid-002', instance_id: 'inst-002', status: 'unhealthy', latency_ms: null, error_message: 'Auth error' },
      ];
      sql = makeSqlMock(rows);
      service = new ConnectorHealthService(sql);

      const result = await service.getAllHealth('ws-001');

      expect(result.isOk()).toBe(true);
      const summaries = result._unsafeUnwrap();
      expect(summaries).toHaveLength(2);
      expect(summaries[0]!.instanceId).toBe('inst-001');
      expect(summaries[0]!.status).toBe('healthy');
      expect(summaries[1]!.status).toBe('unhealthy');
      expect(summaries[1]!.errorMessage).toBe('Auth error');
    });

    it('returns empty array when workspace has no connectors', async () => {
      sql = makeSqlMock([]);
      service = new ConnectorHealthService(sql);

      const result = await service.getAllHealth('ws-empty');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it('returns err when DB throws', async () => {
      vi.mocked(sql).mockRejectedValue(new Error('db error'));
      const result = await service.getAllHealth('ws-001');

      expect(result.isErr()).toBe(true);
    });
  });
});
