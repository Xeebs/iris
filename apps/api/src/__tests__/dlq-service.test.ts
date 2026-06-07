import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SyncJobData } from '@iris/queue';

const mockEnqueueSync = vi.fn();
vi.mock('@iris/queue', () => ({
  SyncJobQueue: vi.fn().mockImplementation(() => ({ enqueueSync: mockEnqueueSync })),
  SYNC_QUEUE_NAME: 'connector-sync',
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const mockSqlResult: unknown[] = [];
const mockSqlFn = vi.fn().mockReturnValue(Promise.resolve(mockSqlResult));
const mockUnsafe = vi.fn().mockReturnValue(Promise.resolve(mockSqlResult));
const sql = new Proxy(mockSqlFn, {
  get: (_target, prop) => {
    if (prop === 'json') return (v: unknown) => v;
    if (prop === 'unsafe') return mockUnsafe;
    return mockSqlFn;
  },
  apply: (_target, _thisArg, args) => mockSqlFn(...args),
}) as unknown as Parameters<typeof import('../services/dlq-service.js').SyncJobDlqService>[0];

const { SyncJobDlqService } = await import('../services/dlq-service.js');

const fakeSyncQueue = { enqueueSync: mockEnqueueSync } as unknown as Parameters<typeof SyncJobDlqService>[1];

const JOB_DATA: SyncJobData = {
  connectorInstanceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  workspaceId: 'ws-test',
  triggeredAt: '2026-06-07T00:00:00.000Z',
};

const FAKE_ENTRY = {
  id: 'dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb',
  jobId: 'bullmq-123',
  connectorInstanceId: JOB_DATA.connectorInstanceId,
  workspaceId: JOB_DATA.workspaceId,
  errorMessage: 'Connection refused',
  errorStack: 'Error: Connection refused\n  at connect (…)',
  attemptCount: 3,
  jobData: JOB_DATA,
  createdAt: '2026-06-07T01:00:00.000Z',
  retriedAt: null,
  retriedBy: null,
};

describe('SyncJobDlqService', () => {
  let service: InstanceType<typeof SyncJobDlqService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncJobDlqService(sql, fakeSyncQueue);
  });

  describe('archive', () => {
    it('inserts the failed job and returns a DlqEntry', async () => {
      mockSqlFn.mockResolvedValueOnce([FAKE_ENTRY]);
      const error = new Error('Connection refused');
      error.stack = 'Error: Connection refused\n  at connect (…)';

      const result = await service.archive('bullmq-123', JOB_DATA, error, 3);

      expect(result.isOk()).toBe(true);
      const entry = result._unsafeUnwrap();
      expect(entry.jobId).toBe('bullmq-123');
      expect(entry.errorMessage).toBe('Connection refused');
      expect(entry.attemptCount).toBe(3);
    });

    it('returns an error when the insert returns no rows', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const result = await service.archive('job-x', JOB_DATA, new Error('fail'), 3);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('no rows');
    });

    it('returns an error when SQL throws', async () => {
      mockSqlFn.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await service.archive('job-y', JOB_DATA, new Error('fail'), 3);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB connection lost');
    });
  });

  describe('listJobs', () => {
    it('returns entries and hasMore=false when fewer than limit+1 rows returned', async () => {
      mockUnsafe.mockResolvedValueOnce([FAKE_ENTRY]);

      const result = await service.listJobs({ workspaceId: 'ws-test', limit: 50 });

      expect(result.isOk()).toBe(true);
      const { entries, hasMore } = result._unsafeUnwrap();
      expect(entries).toHaveLength(1);
      expect(hasMore).toBe(false);
    });

    it('sets hasMore=true and slices when limit+1 rows returned', async () => {
      const row2 = { ...FAKE_ENTRY, id: 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb' };
      mockUnsafe.mockResolvedValueOnce([FAKE_ENTRY, row2]);

      const result = await service.listJobs({ limit: 1 });

      expect(result.isOk()).toBe(true);
      const { entries, hasMore } = result._unsafeUnwrap();
      expect(entries).toHaveLength(1);
      expect(hasMore).toBe(true);
    });

    it('returns error when SQL throws', async () => {
      mockUnsafe.mockRejectedValueOnce(new Error('query failed'));

      const result = await service.listJobs();

      expect(result.isErr()).toBe(true);
    });
  });

  describe('retryJob', () => {
    it('re-enqueues the job and stamps retried_at', async () => {
      const notRetriedEntry = { jobData: JOB_DATA, retriedAt: null };
      mockSqlFn
        .mockResolvedValueOnce([notRetriedEntry])
        .mockResolvedValueOnce([]);
      const enqueuedResult = { jobId: 'new-job-42', connectorInstanceId: JOB_DATA.connectorInstanceId, status: 'queued' as const };
      mockEnqueueSync.mockResolvedValueOnce({
        isOk: () => true,
        isErr: () => false,
        _unsafeUnwrap: () => enqueuedResult,
        value: enqueuedResult,
      });

      const result = await service.retryJob(FAKE_ENTRY.id, 'user-admin');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().newJobId).toBe('new-job-42');
      expect(mockEnqueueSync).toHaveBeenCalledWith(
        JOB_DATA.connectorInstanceId,
        JOB_DATA.workspaceId,
      );
    });

    it('returns error when DLQ entry is not found', async () => {
      mockSqlFn.mockResolvedValueOnce([]);

      const result = await service.retryJob('nonexistent-uuid', 'user');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('not found');
    });

    it('returns conflict error when job was already retried', async () => {
      mockSqlFn.mockResolvedValueOnce([{ jobData: JOB_DATA, retriedAt: '2026-06-07T02:00:00Z' }]);

      const result = await service.retryJob(FAKE_ENTRY.id, 'user');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('already been retried');
    });

    it('returns error when enqueueSync fails', async () => {
      mockSqlFn.mockResolvedValueOnce([{ jobData: JOB_DATA, retriedAt: null }]);
      mockEnqueueSync.mockResolvedValueOnce({
        isOk: () => false,
        isErr: () => true,
        _unsafeUnwrapErr: () => new Error('Redis down'),
        error: new Error('Redis down'),
      });

      const result = await service.retryJob(FAKE_ENTRY.id, 'user');

      expect(result.isErr()).toBe(true);
    });
  });
});
