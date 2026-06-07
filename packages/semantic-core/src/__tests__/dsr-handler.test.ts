import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSubjectRequestHandler } from '../dsr-handler.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const DSR_ROW = {
  id: 'dsr-uuid-1',
  workspace_id: 'ws-1',
  subject_identifier: 'alice@test.com',
  identifier_type: 'email',
  request_type: 'access',
  status: 'pending',
  requested_by: 'admin@test.com',
  export_url: null,
  error_message: null,
  execute_after: null,
  completed_at: null,
  created_at: '2024-01-01T00:00:00Z',
};

describe('DataSubjectRequestHandler', () => {
  let sql: ReturnType<typeof vi.fn>;
  let handler: DataSubjectRequestHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = vi.fn(async () => [DSR_ROW]);
    handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);
  });

  describe('create', () => {
    it('inserts a new DSR and returns it', async () => {
      const result = await handler.create('ws-1', 'alice@test.com', 'email', 'access', 'admin');
      expect(result.isOk()).toBe(true);
      const dsr = result._unsafeUnwrap();
      expect(dsr.subjectIdentifier).toBe('alice@test.com');
      expect(dsr.requestType).toBe('access');
      expect(dsr.status).toBe('pending');
    });

    it('sets execute_after for erasure requests', async () => {
      const erasureRow = { ...DSR_ROW, request_type: 'erasure', execute_after: new Date(Date.now() + 86400000).toISOString() };
      sql = vi.fn(async () => [erasureRow]);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.create('ws-1', 'alice@test.com', 'email', 'erasure');
      expect(result.isOk()).toBe(true);
      const dsr = result._unsafeUnwrap();
      expect(dsr.executeAfter).not.toBeNull();
      expect(dsr.executeAfter!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB error'));
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);
      const result = await handler.create('ws-1', 'alice@test.com', 'email', 'access');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getById', () => {
    it('returns DSR when found', async () => {
      const result = await handler.getById('dsr-uuid-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.id).toBe('dsr-uuid-1');
    });

    it('returns null when not found', async () => {
      sql = vi.fn(async () => []);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);
      const result = await handler.getById('missing', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('connection failed'));
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);
      const result = await handler.getById('dsr-uuid-1', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('executeAccess', () => {
    it('returns subject data with entities', async () => {
      const entities = [
        { id: 'hs:c:1', type: 'contact', label: 'Alice Smith', attributes: { email: 'alice@test.com' }, connector_instance_id: 'hs-inst-1' },
      ];
      let callCount = 0;
      sql = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return []; // UPDATE
        if (callCount === 2) return [{ subject_identifier: 'alice@test.com', identifier_type: 'email' }]; // SELECT request
        if (callCount === 3) return entities; // SELECT entities
        return []; // UPDATE completed + audit
      });
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.executeAccess('dsr-uuid-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.entities).toHaveLength(1);
      expect(data.entities[0]!.id).toBe('hs:c:1');
      expect(data.exportedAt).toBeInstanceOf(Date);
    });

    it('returns err when DSR not found', async () => {
      let callCount = 0;
      sql = vi.fn(async () => {
        callCount++;
        if (callCount === 2) return []; // SELECT request returns empty
        return [];
      });
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.executeAccess('missing', 'ws-1');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');
    });
  });

  describe('executeErasure', () => {
    it('deletes entities and returns count', async () => {
      const deletedEntities = [{ id: 'hs:c:1' }, { id: 'hs:c:2' }];
      let callCount = 0;
      sql = vi.fn(async () => {
        callCount++;
        if (callCount === 1) return [{
          subject_identifier: 'alice@test.com',
          identifier_type: 'email',
          execute_after: null,
          status: 'pending',
        }];
        if (callCount === 3) return deletedEntities; // DELETE
        return [];
      });
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.executeErasure('dsr-uuid-1', 'ws-1', 'admin');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().deletedCount).toBe(2);
    });

    it('returns err if execute_after has not elapsed', async () => {
      sql = vi.fn(async () => [{
        subject_identifier: 'alice@test.com',
        identifier_type: 'email',
        execute_after: new Date(Date.now() + 86400000).toISOString(), // future
        status: 'pending',
      }]);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.executeErasure('dsr-uuid-1', 'ws-1');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('delay');
    });

    it('returns err when already completed', async () => {
      sql = vi.fn(async () => [{
        subject_identifier: 'alice@test.com',
        identifier_type: 'email',
        execute_after: null,
        status: 'completed',
      }]);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.executeErasure('dsr-uuid-1', 'ws-1');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('already been executed');
    });

    it('returns err when cancelled', async () => {
      sql = vi.fn(async () => [{
        subject_identifier: 'alice@test.com',
        identifier_type: 'email',
        execute_after: null,
        status: 'cancelled',
      }]);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.executeErasure('dsr-uuid-1', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('cancel', () => {
    it('cancels a pending DSR', async () => {
      sql = vi.fn(async () => [{ id: 'dsr-uuid-1' }]);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.cancel('dsr-uuid-1', 'ws-1', 'admin');
      expect(result.isOk()).toBe(true);
    });

    it('returns err when DSR not found or not cancellable', async () => {
      sql = vi.fn(async () => []);
      handler = new DataSubjectRequestHandler(sql as unknown as Parameters<typeof DataSubjectRequestHandler>[0]);

      const result = await handler.cancel('dsr-uuid-1', 'ws-1');
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found or not cancellable');
    });
  });
});
