import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAdd = vi.fn();
const mockClose = vi.fn();
const mockGetRepeatableJobs = vi.fn();
const mockRemoveRepeatableByKey = vi.fn();

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockAdd,
    close: mockClose,
    getRepeatableJobs: mockGetRepeatableJobs,
    removeRepeatableByKey: mockRemoveRepeatableByKey,
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const { SyncScheduleService } = await import('../sync-schedule-service.js');

const CONNECTOR_ID = 'inst-uuid-001';
const WORKSPACE_ID = 'ws-test';

describe('SyncScheduleService', () => {
  let sql: ReturnType<typeof vi.fn>;
  let service: InstanceType<typeof SyncScheduleService>;

  beforeEach(() => {
    mockAdd.mockReset();
    mockClose.mockReset();
    mockGetRepeatableJobs.mockReset();
    mockRemoveRepeatableByKey.mockReset();
    sql = vi.fn().mockResolvedValue([]);
    service = new SyncScheduleService(sql as never, 'redis://localhost:6379');
  });

  describe('upsertSchedule', () => {
    it('creates a repeatable job for hourly frequency', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);
      mockAdd.mockResolvedValueOnce({ id: 'job-1' });

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'hourly' });

      expect(result.isOk()).toBe(true);
      expect(mockAdd).toHaveBeenCalledOnce();
      const [, , options] = mockAdd.mock.calls[0] as [unknown, unknown, { repeat: { pattern: string } }];
      expect(options.repeat.pattern).toBe('0 * * * *');
    });

    it('creates a repeatable job for daily frequency', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);
      mockAdd.mockResolvedValueOnce({ id: 'job-2' });

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'daily' });

      expect(result.isOk()).toBe(true);
      const [, , options] = mockAdd.mock.calls[0] as [unknown, unknown, { repeat: { pattern: string } }];
      expect(options.repeat.pattern).toBe('0 9 * * *');
    });

    it('creates a repeatable job for weekly frequency', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);
      mockAdd.mockResolvedValueOnce({ id: 'job-3' });

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'weekly' });

      expect(result.isOk()).toBe(true);
      const [, , options] = mockAdd.mock.calls[0] as [unknown, unknown, { repeat: { pattern: string } }];
      expect(options.repeat.pattern).toBe('0 9 * * 1');
    });

    it('creates a repeatable job for custom cron expression', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);
      mockAdd.mockResolvedValueOnce({ id: 'job-4' });

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, {
        frequency: 'custom',
        cronExpression: '30 6 * * *',
      });

      expect(result.isOk()).toBe(true);
      const [, , options] = mockAdd.mock.calls[0] as [unknown, unknown, { repeat: { pattern: string } }];
      expect(options.repeat.pattern).toBe('30 6 * * *');
    });

    it('does not create a BullMQ job for manual frequency', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'manual' });

      expect(result.isOk()).toBe(true);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('does not create a BullMQ job for real-time frequency', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'real-time' });

      expect(result.isOk()).toBe(true);
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('returns error when DB update throws', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);
      sql.mockRejectedValueOnce(new Error('DB connection failed'));

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'hourly' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('DB connection failed');
    });

    it('returns error for custom frequency with no cron expression', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([]);

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'custom' });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toContain('custom');
    });

    it('removes an existing repeatable job before creating the new one', async () => {
      const existingJob = {
        id: `schedule:${CONNECTOR_ID}`,
        key: 'repeat:some-key',
        name: 'sync',
        cron: '0 * * * *',
        tz: 'UTC',
        next: 0,
      };
      mockGetRepeatableJobs.mockResolvedValueOnce([existingJob]);
      mockRemoveRepeatableByKey.mockResolvedValueOnce(undefined);
      mockAdd.mockResolvedValueOnce({ id: 'new-job' });

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'hourly' });

      expect(result.isOk()).toBe(true);
      expect(mockRemoveRepeatableByKey).toHaveBeenCalledWith('repeat:some-key');
    });

    it('proceeds even when removeSchedule warns about failure', async () => {
      mockGetRepeatableJobs.mockRejectedValueOnce(new Error('Redis hiccup'));
      mockAdd.mockResolvedValueOnce({ id: 'job-ok' });

      const result = await service.upsertSchedule(CONNECTOR_ID, WORKSPACE_ID, { frequency: 'hourly' });

      expect(result.isOk()).toBe(true);
    });
  });

  describe('removeSchedule', () => {
    it('removes the repeatable job when one matches the connector ID', async () => {
      const existingJob = {
        id: `schedule:${CONNECTOR_ID}`,
        key: 'repeat:job-key',
        name: 'sync',
        cron: '0 * * * *',
        tz: 'UTC',
        next: 0,
      };
      mockGetRepeatableJobs.mockResolvedValueOnce([existingJob]);
      mockRemoveRepeatableByKey.mockResolvedValueOnce(undefined);

      const result = await service.removeSchedule(CONNECTOR_ID);

      expect(result.isOk()).toBe(true);
      expect(mockRemoveRepeatableByKey).toHaveBeenCalledWith('repeat:job-key');
    });

    it('does nothing and succeeds when no matching job exists', async () => {
      mockGetRepeatableJobs.mockResolvedValueOnce([
        { id: 'schedule:other-connector', key: 'other-key', name: 'sync', cron: '0 * * * *', tz: 'UTC', next: 0 },
      ]);

      const result = await service.removeSchedule(CONNECTOR_ID);

      expect(result.isOk()).toBe(true);
      expect(mockRemoveRepeatableByKey).not.toHaveBeenCalled();
    });

    it('returns error when getRepeatableJobs throws', async () => {
      mockGetRepeatableJobs.mockRejectedValueOnce(new Error('Redis error'));

      const result = await service.removeSchedule(CONNECTOR_ID);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('getSchedule', () => {
    it('returns schedule config when connector instance is found', async () => {
      sql.mockResolvedValueOnce([
        { sync_frequency: 'hourly', sync_schedule_cron: null, sync_start_time: null },
      ]);

      const result = await service.getSchedule(WORKSPACE_ID, CONNECTOR_ID);

      expect(result.isOk()).toBe(true);
      const schedule = result._unsafeUnwrap();
      expect(schedule?.frequency).toBe('hourly');
      expect(schedule?.connectorInstanceId).toBe(CONNECTOR_ID);
      expect(schedule?.cronExpression).toBeNull();
    });

    it('returns schedule with custom cron when frequency is custom', async () => {
      sql.mockResolvedValueOnce([
        { sync_frequency: 'custom', sync_schedule_cron: '0 6 * * 1-5', sync_start_time: null },
      ]);

      const result = await service.getSchedule(WORKSPACE_ID, CONNECTOR_ID);

      expect(result.isOk()).toBe(true);
      const schedule = result._unsafeUnwrap();
      expect(schedule?.frequency).toBe('custom');
      expect(schedule?.cronExpression).toBe('0 6 * * 1-5');
    });

    it('returns null when no matching instance found', async () => {
      sql.mockResolvedValueOnce([]);

      const result = await service.getSchedule(WORKSPACE_ID, CONNECTOR_ID);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns error when the DB query throws', async () => {
      sql.mockRejectedValueOnce(new Error('Query failed'));

      const result = await service.getSchedule(WORKSPACE_ID, CONNECTOR_ID);

      expect(result.isErr()).toBe(true);
    });
  });

  describe('close', () => {
    it('closes the underlying BullMQ queue', async () => {
      await service.close();
      expect(mockClose).toHaveBeenCalledOnce();
    });
  });
});
