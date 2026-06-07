import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockListJobs = vi.fn();
const mockRetryJob = vi.fn();

vi.mock('@iris/queue', () => ({
  SyncJobQueue: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../services/dlq-service.js', () => ({
  SyncJobDlqService: vi.fn().mockImplementation(() => ({
    listJobs: mockListJobs,
    retryJob: mockRetryJob,
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

const { createAdminDlqRoutes } = await import('../routes/admin-dlq.js');

const FAKE_ENTRY = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  jobId: 'bullmq-abc',
  connectorInstanceId: 'ffffffff-aaaa-bbbb-cccc-dddddddddddd',
  workspaceId: 'ws-test',
  errorMessage: 'Timeout',
  errorStack: null,
  attemptCount: 3,
  jobData: { connectorInstanceId: 'ffffffff-aaaa-bbbb-cccc-dddddddddddd', workspaceId: 'ws-test', triggeredAt: '2026-06-07T00:00:00Z' },
  createdAt: '2026-06-07T01:00:00Z',
  retriedAt: null,
  retriedBy: null,
};

function makeOk<T>(value: T) {
  return { isOk: () => true, isErr: () => false, _unsafeUnwrap: () => value, value };
}

function makeErr(message: string) {
  const e = new Error(message);
  return { isOk: () => false, isErr: () => true, _unsafeUnwrapErr: () => e, error: e };
}

function buildApp(): Hono {
  const sql = {} as Parameters<typeof createAdminDlqRoutes>[0];
  const app = new Hono();
  app.route('/admin/dlq', createAdminDlqRoutes(sql, 'redis://localhost:6379'));
  return app;
}

describe('GET /admin/dlq', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated DLQ entries', async () => {
    mockListJobs.mockResolvedValueOnce(makeOk({ entries: [FAKE_ENTRY], hasMore: false }));

    const app = buildApp();
    const res = await app.request('/admin/dlq?workspaceId=ws-test');
    const body = await res.json() as { data: typeof FAKE_ENTRY[]; meta: { hasMore: boolean } };

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.errorMessage).toBe('Timeout');
    expect(body.meta.hasMore).toBe(false);
  });

  it('includes nextCursor when hasMore=true', async () => {
    const entry2 = { ...FAKE_ENTRY, id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' };
    mockListJobs.mockResolvedValueOnce(makeOk({ entries: [FAKE_ENTRY, entry2], hasMore: true }));

    const app = buildApp();
    const res = await app.request('/admin/dlq');
    const body = await res.json() as { meta: { hasMore: boolean; nextCursor?: string } };

    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBe(entry2.id);
  });

  it('returns 400 for invalid limit', async () => {
    const app = buildApp();
    const res = await app.request('/admin/dlq?limit=999');
    expect(res.status).toBe(400);
  });

  it('returns 500 when service errors', async () => {
    mockListJobs.mockResolvedValueOnce(makeErr('DB connection lost'));

    const app = buildApp();
    const res = await app.request('/admin/dlq');
    expect(res.status).toBe(500);
  });
});

describe('POST /admin/dlq/:jobId/retry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns new job ID on successful retry', async () => {
    mockRetryJob.mockResolvedValueOnce(makeOk({ newJobId: 'new-job-99' }));

    const app = buildApp();
    const res = await app.request(`/admin/dlq/${FAKE_ENTRY.id}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retriedBy: 'test-admin' }),
    });

    const body = await res.json() as { data: { newJobId: string; dlqId: string } };
    expect(res.status).toBe(200);
    expect(body.data.newJobId).toBe('new-job-99');
    expect(body.data.dlqId).toBe(FAKE_ENTRY.id);
  });

  it('returns 404 when DLQ entry not found', async () => {
    mockRetryJob.mockResolvedValueOnce(makeErr('DLQ entry abc not found'));

    const app = buildApp();
    const res = await app.request('/admin/dlq/nonexistent-id/retry', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(404);
  });

  it('returns 409 when job was already retried', async () => {
    mockRetryJob.mockResolvedValueOnce(makeErr('DLQ entry abc has already been retried at 2026-06-07'));

    const app = buildApp();
    const res = await app.request(`/admin/dlq/${FAKE_ENTRY.id}/retry`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(409);
  });

  it('returns 500 on internal service error', async () => {
    mockRetryJob.mockResolvedValueOnce(makeErr('Queue unavailable'));

    const app = buildApp();
    const res = await app.request(`/admin/dlq/${FAKE_ENTRY.id}/retry`, {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(500);
  });

  it('works with no body (uses defaults)', async () => {
    mockRetryJob.mockResolvedValueOnce(makeOk({ newJobId: 'new-job-100' }));

    const app = buildApp();
    const res = await app.request(`/admin/dlq/${FAKE_ENTRY.id}/retry`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
  });
});
