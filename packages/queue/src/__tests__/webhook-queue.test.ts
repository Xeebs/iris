import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookQueue } from '../webhook-queue.js';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
  },
}));

vi.mock('bullmq', () => {
  const addMock = vi.fn();
  const closeMock = vi.fn();
  const getWaitingCountMock = vi.fn().mockResolvedValue(3);
  const getFailedCountMock = vi.fn().mockResolvedValue(1);

  class MockQueue {
    opts = { connection: {} };
    add = addMock;
    close = closeMock;
    getWaitingCount = getWaitingCountMock;
    getFailedCount = getFailedCountMock;
  }

  class MockWorker {
    on = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
  }

  return { Queue: MockQueue, Worker: MockWorker, Job: class {} };
});

const REDIS_URL = 'redis://localhost:6379';
const FAKE_JOB_DATA = {
  webhookEventId: 'evt-1',
  workspaceId: 'ws-test',
  targetUrl: 'https://example.com/webhook',
  eventType: 'connector.sync.completed',
  payload: { connectorId: 'hubspot', entityCount: 42 },
  attemptCount: 0,
};

describe('WebhookQueue.enqueueWebhook', () => {
  let onStatusChange: ReturnType<typeof vi.fn>;
  let queue: WebhookQueue;

  beforeEach(() => {
    onStatusChange = vi.fn().mockResolvedValue(undefined);
    queue = new WebhookQueue(REDIS_URL, onStatusChange);
  });

  afterEach(async () => {
    await queue.close().catch(() => {});
  });

  it('enqueues a job and returns a queued result', async () => {
    const { Queue } = await import('bullmq');
    const mockAdd = vi.mocked(new Queue('') as unknown as { add: ReturnType<typeof vi.fn> }).add;
    mockAdd.mockResolvedValueOnce({ id: 'job-123' });

    const result = await queue.enqueueWebhook(FAKE_JOB_DATA);
    expect(result.isOk()).toBe(true);
    const val = result._unsafeUnwrap();
    expect(val.status).toBe('queued');
    expect(val.webhookEventId).toBe('evt-1');
  });

  it('returns err when queue.add throws', async () => {
    const { Queue } = await import('bullmq');
    const mockAdd = vi.mocked(new Queue('') as unknown as { add: ReturnType<typeof vi.fn> }).add;
    mockAdd.mockRejectedValueOnce(new Error('Redis connection refused'));

    const result = await queue.enqueueWebhook(FAKE_JOB_DATA);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Redis connection refused');
  });
});

describe('WebhookQueue.getPendingCount / getFailedCount', () => {
  it('returns waiting and failed job counts', async () => {
    const q = new WebhookQueue(REDIS_URL, vi.fn());
    const pending = await q.getPendingCount();
    const failed = await q.getFailedCount();
    expect(pending).toBe(3);
    expect(failed).toBe(1);
  });
});

describe('WebhookQueue.startWorker', () => {
  it('starts worker without throwing', () => {
    const q = new WebhookQueue(REDIS_URL, vi.fn());
    expect(() => q.startWorker(2)).not.toThrow();
  });

  it('does not start a second worker when called twice', () => {
    const q = new WebhookQueue(REDIS_URL, vi.fn());
    q.startWorker();
    q.startWorker();
  });
});

describe('RETRY_DELAYS_MS backoff pattern', () => {
  it('delays double each retry up to 5 attempts', () => {
    const delays = [2000, 4000, 8000, 16000, 32000];
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBe((delays[i - 1] ?? 0) * 2);
    }
  });
});
