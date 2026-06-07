import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

function buildApp(workspaceId: string | null = 'ws-1') {
  const outer = new Hono();
  outer.use('*', async (c, next) => {
    if (workspaceId) c.set('workspaceId', workspaceId);
    await next();
  });
  return outer;
}

async function importRoutes() {
  const mod = await import('../routes/request-traces.js');
  return mod;
}

describe('request-traces routes', () => {
  let createRequestTracesRoutes: Awaited<ReturnType<typeof importRoutes>>['createRequestTracesRoutes'];
  let recordSpan: Awaited<ReturnType<typeof importRoutes>>['recordSpan'];
  let mockSql: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSql = vi.fn().mockResolvedValue([]);
    const mod = await importRoutes();
    createRequestTracesRoutes = mod.createRequestTracesRoutes;
    recordSpan = mod.recordSpan;
  });

  describe('GET /:correlationId', () => {
    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces/abc12345678');
      expect(res.status).toBe(401);
    });

    it('returns 400 for short correlationId', async () => {
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces/short');
      expect(res.status).toBe(400);
    });

    it('returns 200 with empty timeline when no spans found', async () => {
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces/abc1234567890abc');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { correlationId: string; spanCount: number } };
      expect(body.data.correlationId).toBe('abc1234567890abc');
      expect(body.data.spanCount).toBe(0);
    });

    it('includes recorded spans in timeline', async () => {
      const correlationId = `test-${Date.now()}-xyz`;
      recordSpan({
        correlationId,
        traceId: 'tid1',
        spanId: 'sid1',
        service: 'api',
        operation: 'GET /entities',
        startTimeMs: Date.now() - 100,
        durationMs: 45,
        statusCode: 200,
        metadata: {},
      });

      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request(`/traces/${correlationId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { spanCount: number; timeline: unknown[] } };
      expect(body.data.spanCount).toBe(1);
      expect(body.data.timeline).toHaveLength(1);
    });

    it('merges audit events into timeline', async () => {
      mockSql.mockResolvedValue([
        {
          id: 'log1',
          action: 'entity_read',
          actor_id: 'u1',
          resource_type: 'contact',
          created_at: new Date(),
          metadata: { correlationId: 'corr-abc123456789' },
        },
      ]);
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces/corr-abc123456789');
      const body = await res.json() as { data: { auditEventCount: number } };
      expect(body.data.auditEventCount).toBe(1);
    });

    it('returns 200 even when audit log query fails', async () => {
      mockSql.mockRejectedValue(new Error('db down'));
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces/abc1234567890xyz');
      expect(res.status).toBe(200);
    });
  });

  describe('GET / (slow requests)', () => {
    it('returns 401 without workspace', async () => {
      const app = buildApp(null);
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces');
      expect(res.status).toBe(401);
    });

    it('returns 200 with empty list when no slow requests', async () => {
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns slow requests from audit log', async () => {
      mockSql.mockResolvedValue([
        {
          metadata: { correlationId: 'slow-corr', durationMs: 2500 },
          created_at: new Date(),
          action: 'entity_read',
        },
      ]);
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces?minDurationMs=500');
      const body = await res.json() as { data: { durationMs: number }[] };
      expect(body.data[0]!.durationMs).toBe(2500);
    });

    it('returns empty list when audit query fails', async () => {
      mockSql.mockRejectedValue(new Error('timeout'));
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request('/traces');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  describe('recordSpan', () => {
    it('spans become visible in the trace route response', async () => {
      const correlationId = `span-test-${Date.now()}-abc`;
      recordSpan({
        correlationId,
        traceId: 't1',
        spanId: 's1',
        service: 'test',
        operation: 'unit-test',
        startTimeMs: Date.now(),
        durationMs: 10,
        metadata: { unit: true },
      });
      const app = buildApp();
      app.route('/traces', createRequestTracesRoutes(mockSql as never));
      const res = await app.request(`/traces/${correlationId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { spanCount: number } };
      expect(body.data.spanCount).toBeGreaterThan(0);
    });
  });
});
