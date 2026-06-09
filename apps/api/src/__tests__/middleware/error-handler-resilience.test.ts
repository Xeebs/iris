import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { errorHandlerResilience } from '../../middleware/error-handler-resilience.js';
import type { Context } from 'hono';

function makeCtx(path = '/test', correlationId?: string): Context {
  const headers: Record<string, string> = {};
  if (correlationId) headers['x-correlation-id'] = correlationId;
  const app = new Hono();
  let capturedCtx!: Context;
  app.use('*', async (c, next) => { capturedCtx = c; await next(); });
  app.get(path, (c) => c.text('ok'));
  app.request(path, { headers });
  return capturedCtx;
}

async function runMiddleware(errorMsg: string, correlationId?: string) {
  const app = new Hono();
  const headers: Record<string, string> = {};
  if (correlationId) headers['x-correlation-id'] = correlationId;

  app.get('/test', async (c) => {
    const next = async () => { throw new Error(errorMsg); };
    const res = await errorHandlerResilience(c, next);
    return res ?? c.text('ok');
  });

  return app.request('/test', { headers });
}

describe('errorHandlerResilience', () => {
  it('maps "timeout" error to 502 UPSTREAM_TIMEOUT', async () => {
    const res = await runMiddleware('connection timed out after 10s');
    expect(res.status).toBe(502);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('maps "circuit" error to 503 SERVICE_UNAVAILABLE', async () => {
    const res = await runMiddleware('circuit breaker open');
    expect(res.status).toBe(503);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('maps "rate limit" error to 429 RATE_LIMITED', async () => {
    const res = await runMiddleware('rate limit exceeded');
    expect(res.status).toBe(429);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('maps "unauthorized" error to 401', async () => {
    const res = await runMiddleware('unauthorized access');
    expect(res.status).toBe(401);
  });

  it('maps "forbidden" error to 403', async () => {
    const res = await runMiddleware('forbidden resource');
    expect(res.status).toBe(403);
  });

  it('maps generic errors to 500 INTERNAL_ERROR', async () => {
    const res = await runMiddleware('something unknown happened');
    expect(res.status).toBe(500);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('includes correlationId in error response', async () => {
    const res = await runMiddleware('boom');
    const body = await res.json() as { error: { correlationId: string } };
    expect(typeof body.error.correlationId).toBe('string');
    expect(body.error.correlationId.length).toBeGreaterThan(0);
  });

  it('uses x-correlation-id from request if provided', async () => {
    const app = new Hono();
    app.get('/test', async (c) => {
      const next = async () => { throw new Error('boom'); };
      const res = await errorHandlerResilience(c, next);
      return res ?? c.text('ok');
    });
    const res = await app.request('/test', { headers: { 'x-correlation-id': 'my-trace-id' } });
    const body = await res.json() as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe('my-trace-id');
  });

  it('does not throw when downstream succeeds', async () => {
    const app = new Hono();
    app.get('/test', async (c) => {
      const next = vi.fn().mockResolvedValue(undefined);
      await errorHandlerResilience(c, next);
      return c.json({ ok: true });
    });
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});
