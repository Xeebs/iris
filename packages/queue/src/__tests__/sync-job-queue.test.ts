import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdd = vi.fn();
const mockGetJob = vi.fn();
const mockClose = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockAdd,
    getJob: mockGetJob,
    close: mockClose,
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const { SyncJobQueue, SyncPerformanceTracker, SYNC_QUEUE_NAME } = await import('../sync-job-queue.js');

describe('SyncJobQueue', () => {
  let queue: InstanceType<typeof SyncJobQueue>;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new SyncJobQueue('redis://localhost:6379');
  });

  describe('enqueueSync', () => {
    it('enqueues a job and returns jobId with queued status', async () => {
      mockAdd.mockResolvedValueOnce({ id: 'job-abc-123' });

      const result = await queue.enqueueSync('instance-1', 'workspace-1');

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value.jobId).toBe('job-abc-123');
      expect(value.connectorInstanceId).toBe('instance-1');
      expect(value.status).toBe('queued');
    });

    it('passes correct job data including triggeredAt', async () => {
      mockAdd.mockResolvedValueOnce({ id: 'job-xyz' });
      const before = new Date().toISOString();

      await queue.enqueueSync('instance-2', 'workspace-2');

      const [jobName, jobData] = mockAdd.mock.calls[0] as [string, Record<string, unknown>];
      expect(jobName).toBe('sync');
      expect(jobData.connectorInstanceId).toBe('instance-2');
      expect(jobData.workspaceId).toBe('workspace-2');
      expect(typeof jobData.triggeredAt).toBe('string');
      expect(new Date(jobData.triggeredAt as string) >= new Date(before)).toBe(true);
    });

    it('returns an error when the queue add throws', async () => {
      mockAdd.mockRejectedValueOnce(new Error('Redis connection refused'));

      const result = await queue.enqueueSync('instance-3', 'workspace-3');

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('Redis connection refused');
    });
  });

  describe('getJobStatus', () => {
    it('returns null when the job does not exist', async () => {
      mockGetJob.mockResolvedValueOnce(null);

      const result = await queue.getJobStatus('nonexistent-job');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns the job state string', async () => {
      const mockGetState = vi.fn().mockResolvedValueOnce('completed');
      mockGetJob.mockResolvedValueOnce({ getState: mockGetState });

      const result = await queue.getJobStatus('job-done');

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe('completed');
    });

    it('returns error when getJob throws', async () => {
      mockGetJob.mockRejectedValueOnce(new Error('Redis timeout'));

      const result = await queue.getJobStatus('job-err');

      expect(result.isErr()).toBe(true);
    });
  });

  describe('close', () => {
    it('calls queue.close()', async () => {
      await queue.close();
      expect(mockClose).toHaveBeenCalledOnce();
    });
  });

  it('exports the SYNC_QUEUE_NAME constant', () => {
    expect(SYNC_QUEUE_NAME).toBe('connector-sync');
  });
});

describe('SyncPerformanceTracker', () => {
  let mockSql: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSql = vi.fn((..._args: unknown[]) => Promise.resolve([{ id: 'perf-row-1' }]));
  });

  it('inserts a started record and returns row id', async () => {
    const tracker = new SyncPerformanceTracker(mockSql as Parameters<typeof SyncPerformanceTracker>[0]);
    const rowId = await tracker.start('job-1', 'inst-1', 'ws-1');
    expect(rowId).toBe('perf-row-1');
    expect(mockSql).toHaveBeenCalledOnce();
  });

  it('updates record with metrics on complete', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'perf-row-1' }]); // start
    mockSql.mockResolvedValueOnce([]); // complete update

    const tracker = new SyncPerformanceTracker(mockSql as Parameters<typeof SyncPerformanceTracker>[0]);
    const rowId = await tracker.start('job-1', 'inst-1', 'ws-1');
    await tracker.complete(rowId, {
      apiTimeMs: 1000,
      indexingTimeMs: 2000,
      apiCalls: 5,
      entitiesSynced: 100,
    });

    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('marks record as failed on fail()', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'perf-row-1' }]); // start
    mockSql.mockResolvedValueOnce([]); // fail update

    const tracker = new SyncPerformanceTracker(mockSql as Parameters<typeof SyncPerformanceTracker>[0]);
    const rowId = await tracker.start('job-1', 'inst-1', 'ws-1');
    await tracker.fail(rowId, 3);

    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('returns empty string when insert returns no rows', async () => {
    mockSql.mockResolvedValueOnce([]);

    const tracker = new SyncPerformanceTracker(mockSql as Parameters<typeof SyncPerformanceTracker>[0]);
    const rowId = await tracker.start('job-1', 'inst-1', 'ws-1');

    expect(rowId).toBe('');
  });
});
