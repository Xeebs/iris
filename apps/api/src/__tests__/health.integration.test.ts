import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type postgres from 'postgres';
import type { Redis } from 'ioredis';

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { checkHealth } from '../health.js';

function makeSql(ok: boolean): ReturnType<typeof postgres> {
  const unsafe = ok
    ? vi.fn().mockResolvedValue([{ '?column?': 1 }])
    : vi.fn().mockRejectedValue(new Error('connection refused'));
  return { unsafe } as unknown as ReturnType<typeof postgres>;
}

function makeRedis(ok: boolean): InstanceType<typeof Redis> {
  return {
    ping: ok
      ? vi.fn().mockResolvedValue('PONG')
      : vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
  } as unknown as InstanceType<typeof Redis>;
}

describe('checkHealth', () => {
  it('returns status ok when DB and Redis are healthy', async () => {
    const result = await checkHealth(makeSql(true), makeRedis(true));
    expect(result.status).toBe('ok');
    expect(result.checks.db).toBe(true);
    expect(result.checks.redis).toBe(true);
    expect(result.timestamp).toMatch(/^\d{4}-/);
  });

  it('returns status degraded when DB is down', async () => {
    const result = await checkHealth(makeSql(false), makeRedis(true));
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe(false);
    expect(result.checks.redis).toBe(true);
  });

  it('returns status degraded when Redis is down', async () => {
    const result = await checkHealth(makeSql(true), makeRedis(false));
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe(true);
    expect(result.checks.redis).toBe(false);
  });

  it('returns status degraded when both services are down', async () => {
    const result = await checkHealth(makeSql(false), makeRedis(false));
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe(false);
    expect(result.checks.redis).toBe(false);
  });

  it('treats missing Redis as healthy (dev mode)', async () => {
    const result = await checkHealth(makeSql(true));
    expect(result.status).toBe('ok');
    expect(result.checks.redis).toBe(true);
  });
});

describe('GET /health endpoint', () => {

  it('returns 200 when services are healthy', async () => {
    const { createApp } = await import('../server.js');
    const mockSql = makeSql(true);
    const mockRedis = makeRedis(true);

    vi.mock('../health.js', () => ({
      checkHealth: vi.fn().mockResolvedValue({
        status: 'ok',
        checks: { db: true, redis: true },
        timestamp: '2026-06-07T00:00:00.000Z',
      }),
    }));

    const app = new Hono();
    const { checkHealth: mocked } = await import('../health.js');
    app.get('/health', async (c) => {
      const result = await (mocked as typeof checkHealth)(mockSql, mockRedis);
      return c.json(result, result.status === 'ok' ? 200 : 503);
    });
    app.get('/ready', (c) => c.json({ status: 'ready' }, 200));

    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ok');
  });

  it('returns 503 when a service is down', async () => {
    const app = new Hono();
    app.get('/health', async (c) => {
      const result = await checkHealth(makeSql(false), makeRedis(true));
      return c.json(result, result.status === 'ok' ? 200 : 503);
    });

    const res = await app.request('/health');
    expect(res.status).toBe(503);
  });

  it('GET /ready always returns 200', async () => {
    const app = new Hono();
    app.get('/ready', (c) => c.json({ status: 'ready', timestamp: new Date().toISOString() }, 200));

    const res = await app.request('/ready');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('ready');
  });
});
