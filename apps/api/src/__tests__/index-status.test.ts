import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@iris/semantic-core')>();
  return {
    ...actual,
    IndexStatusService: vi.fn(),
  };
});

import { IndexStatusService } from '@iris/semantic-core';
import { createIndexStatusRoutes } from '../routes/index-status.js';

const WORKSPACE = 'ws-test';
const FAKE_STATUS = {
  totalEntities: 250,
  totalBytes: 52000,
  lastIndexedAt: new Date('2026-06-01T10:00:00Z'),
  coverageByType: [
    { entityType: 'contact', entityCount: 150, totalBytes: 30000, lastIndexedAt: new Date('2026-06-01T10:00:00Z') },
    { entityType: 'deal', entityCount: 100, totalBytes: 22000, lastIndexedAt: new Date('2026-05-31T10:00:00Z') },
  ],
};

function makeApp(mockMethods: Partial<{
  getIndexStatus: ReturnType<typeof vi.fn>;
  recordEntityIndex: ReturnType<typeof vi.fn>;
}>): Hono {
  vi.mocked(IndexStatusService).mockImplementation(() => mockMethods as InstanceType<typeof IndexStatusService>);
  const fakeSql = {} as Parameters<typeof createIndexStatusRoutes>[0];
  const app = new Hono();
  app.route('/api/v1/index', createIndexStatusRoutes(fakeSql));
  return app;
}

describe('GET /api/v1/index/status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp({});
    const res = await app.request('/api/v1/index/status');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with index status when workspaceId is provided', async () => {
    const { ok } = await import('neverthrow');
    const getIndexStatus = vi.fn().mockResolvedValue(ok(FAKE_STATUS));
    const app = makeApp({ getIndexStatus });

    const res = await app.request(`/api/v1/index/status?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(200);

    const body = await res.json() as { data: typeof FAKE_STATUS };
    expect(body.data.totalEntities).toBe(250);
    expect(body.data.totalBytes).toBe(52000);
    expect(body.data.coverageByType).toHaveLength(2);
    expect(getIndexStatus).toHaveBeenCalledWith(WORKSPACE);
  });

  it('returns coverage breakdown with entity types', async () => {
    const { ok } = await import('neverthrow');
    const getIndexStatus = vi.fn().mockResolvedValue(ok(FAKE_STATUS));
    const app = makeApp({ getIndexStatus });

    const res = await app.request(`/api/v1/index/status?workspaceId=${WORKSPACE}`);
    const body = await res.json() as { data: typeof FAKE_STATUS };

    const types = body.data.coverageByType.map((c: { entityType: string }) => c.entityType);
    expect(types).toContain('contact');
    expect(types).toContain('deal');
  });

  it('returns 500 when service throws', async () => {
    const { err } = await import('neverthrow');
    const getIndexStatus = vi.fn().mockResolvedValue(err(new Error('DB connection lost')));
    const app = makeApp({ getIndexStatus });

    const res = await app.request(`/api/v1/index/status?workspaceId=${WORKSPACE}`);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
