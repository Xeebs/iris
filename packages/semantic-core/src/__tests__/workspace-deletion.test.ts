import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceDeletionService } from '../workspace-deletion.js';

const mockSqlFn = Object.assign(
  vi.fn((..._args: unknown[]) => Promise.resolve([])),
  {
    begin: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const mockTx = Object.assign(vi.fn(() => Promise.resolve({ count: 5 })), {
        begin: vi.fn(),
      });
      await fn(mockTx);
    }),
  },
) as unknown as ReturnType<typeof import('postgres').default>;

function makeService() {
  return new WorkspaceDeletionService(mockSqlFn);
}

describe('WorkspaceDeletionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
    (mockSqlFn as unknown as { begin: ReturnType<typeof vi.fn> }).begin = vi.fn(
      async (fn: (tx: unknown) => Promise<void>) => {
        const mockTx = Object.assign(vi.fn(() => Promise.resolve({ count: 5 })), { begin: vi.fn() });
        await fn(mockTx);
      },
    );
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

  describe('requestDeletion', () => {
    it('creates a deletion request with 30-day grace period by default', async () => {
      mockSqlFn.mockResolvedValueOnce([]); // no existing request
      mockSqlFn.mockResolvedValueOnce([]); // no policy (legal hold check)
      mockSqlFn.mockResolvedValueOnce([{
        id: 'req-1',
        workspace_id: 'ws-1',
        requested_by: 'user-1',
        reason: 'closing account',
        status: 'pending',
        scheduled_at: new Date(Date.now() + 30 * 86400000),
        created_at: new Date(),
      }]);
      mockSqlFn.mockResolvedValueOnce([]); // audit insert

      const svc = makeService();
      const result = await svc.requestDeletion('ws-1', 'user-1', { reason: 'closing account' });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().status).toBe('pending');
      expect(result._unsafeUnwrap().workspaceId).toBe('ws-1');
    });

    it('returns error when a pending request already exists', async () => {
      mockSqlFn.mockResolvedValueOnce([{ id: 'req-1', status: 'pending' }]);

      const svc = makeService();
      const result = await svc.requestDeletion('ws-1', 'user-1');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('already pending');
    });

    it('returns error when workspace is under legal hold', async () => {
      mockSqlFn.mockResolvedValueOnce([]); // no pending request
      mockSqlFn.mockResolvedValueOnce([{
        workspace_id: 'ws-1',
        retention_days: 30,
        backup_before_deletion: true,
        legal_hold: true,
      }]);

      const svc = makeService();
      const result = await svc.requestDeletion('ws-1', 'user-1');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('legal hold');
    });

    it('uses custom retention days when provided', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      mockSqlFn.mockResolvedValueOnce([]);
      const futureDate = new Date(Date.now() + 7 * 86400000);
      mockSqlFn.mockResolvedValueOnce([{
        id: 'req-2',
        workspace_id: 'ws-1',
        requested_by: 'user-1',
        reason: null,
        status: 'pending',
        scheduled_at: futureDate,
        created_at: new Date(),
      }]);
      mockSqlFn.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.requestDeletion('ws-1', 'user-1', { retentionDays: 7 });

      expect(result.isOk()).toBe(true);
    });
  });

  describe('cancelDeletion', () => {
    it('cancels a pending deletion request', async () => {
      const futureDate = new Date(Date.now() + 20 * 86400000);
      mockSqlFn.mockResolvedValueOnce([{
        id: 'req-1',
        workspace_id: 'ws-1',
        requested_by: 'user-1',
        reason: null,
        status: 'cancelled',
        scheduled_at: futureDate,
        cancelled_at: new Date(),
        completed_at: null,
        created_at: new Date(),
      }]);
      mockSqlFn.mockResolvedValueOnce([]); // audit

      const svc = makeService();
      const result = await svc.cancelDeletion('ws-1', 'user-1');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().status).toBe('cancelled');
    });

    it('returns error when no cancellable request exists', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.cancelDeletion('ws-1', 'user-1');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('No cancellable');
    });
  });

  describe('getDeletionStatus', () => {
    it('returns null when no deletion request exists', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.getDeletionStatus('ws-1');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns the most recent deletion request', async () => {
      const scheduledAt = new Date(Date.now() + 30 * 86400000);
      mockSqlFn.mockResolvedValueOnce([{
        id: 'req-1',
        workspace_id: 'ws-1',
        requested_by: 'admin-user',
        reason: 'gdpr',
        status: 'pending',
        scheduled_at: scheduledAt,
        backup_export_id: null,
        cancelled_at: null,
        completed_at: null,
        created_at: new Date(),
      }]);

      const svc = makeService();
      const result = await svc.getDeletionStatus('ws-1');

      expect(result.isOk()).toBe(true);
      const req = result._unsafeUnwrap();
      expect(req?.status).toBe('pending');
      expect(req?.reason).toBe('gdpr');
      expect(req?.requestedBy).toBe('admin-user');
    });
  });

  describe('permanentlyDelete', () => {
    it('returns error when no active deletion request exists', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.permanentlyDelete('ws-1', 'admin');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('No active deletion request');
    });

    it('returns error when grace period has not elapsed', async () => {
      const futureDate = new Date(Date.now() + 10 * 86400000);
      mockSqlFn.mockResolvedValueOnce([{
        id: 'req-1',
        status: 'pending',
        scheduled_at: futureDate,
      }]);

      const svc = makeService();
      const result = await svc.permanentlyDelete('ws-1', 'admin');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('Grace period has not elapsed');
    });

    it('succeeds when grace period has elapsed', async () => {
      const pastDate = new Date(Date.now() - 1000);
      mockSqlFn.mockResolvedValueOnce([{
        id: 'req-1',
        status: 'pending',
        scheduled_at: pastDate,
      }]);

      const svc = makeService();
      const result = await svc.permanentlyDelete('ws-1', 'admin');

      expect(result.isOk()).toBe(true);
      const counts = result._unsafeUnwrap();
      expect(typeof counts).toBe('object');
    });
  });

  describe('getPolicy', () => {
    it('returns default policy when no policy exists', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.getPolicy('ws-1');

      expect(result.isOk()).toBe(true);
      const policy = result._unsafeUnwrap();
      expect(policy.retentionDays).toBe(30);
      expect(policy.backupBeforeDeletion).toBe(true);
      expect(policy.legalHold).toBe(false);
    });

    it('returns persisted policy when it exists', async () => {
      mockSqlFn.mockResolvedValueOnce([{
        workspace_id: 'ws-1',
        retention_days: 60,
        backup_before_deletion: false,
        legal_hold: true,
      }]);

      const svc = makeService();
      const result = await svc.getPolicy('ws-1');

      expect(result.isOk()).toBe(true);
      const policy = result._unsafeUnwrap();
      expect(policy.retentionDays).toBe(60);
      expect(policy.legalHold).toBe(true);
    });
  });

  describe('updatePolicy', () => {
    it('upserts policy and returns updated values', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const svc = makeService();
      const result = await svc.updatePolicy('ws-1', {
        retentionDays: 90,
        legalHold: true,
      });

      expect(result.isOk()).toBe(true);
      const policy = result._unsafeUnwrap();
      expect(policy.retentionDays).toBe(90);
      expect(policy.legalHold).toBe(true);
    });
  });
});
