import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { BenchmarkingService } from '@iris/semantic-core/benchmarking';

type SqlClient = ReturnType<typeof postgres>;

const optInSchema = z.object({
  industry: z.string().min(1).max(100),
  companySize: z.enum(['startup', 'smb', 'midmarket', 'enterprise']),
});

/**
 * Benchmarking routes: opt-in management and peer comparison.
 * Exposes /opt-in (GET status, POST join), /opt-out (POST), /peers (GET comparison).
 *
 * @param sql - Postgres client
 */
export function createBenchmarkingRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const getSvc = () => new BenchmarkingService(sql);

  /** GET /opt-in — get opt-in status and settings */
  app.get('/opt-in', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await getSvc().getSettings(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /opt-in — join benchmarking pool */
  app.post('/opt-in', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const body = await c.req.json().catch(() => null);
    const parsed = optInSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { industry, companySize } = parsed.data;
    const result = await getSvc().updateSettings(workspaceId, {
      benchmarkingEnabled: true, industry, companySize,
    });
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** POST /opt-out — leave benchmarking pool */
  app.post('/opt-out', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await getSvc().updateSettings(workspaceId, { benchmarkingEnabled: false });
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { optedOut: true } });
  });

  /** GET /peers — peer comparison with percentile rankings */
  app.get('/peers', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const industry = c.req.query('industry');
    const companySizeRaw = c.req.query('companySize');
    const companySizeParsed = z.enum(['startup', 'smb', 'midmarket', 'enterprise']).safeParse(companySizeRaw);
    const companySize = companySizeParsed.success ? companySizeParsed.data : undefined;
    const result = await getSvc().getPeerBenchmarks(workspaceId, industry, companySize);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('No snapshot')) return c.json({ error: { code: 'NO_SNAPSHOT', message: msg } }, 422);
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
