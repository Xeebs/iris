import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { BenchmarkingService } from '@iris/semantic-core/benchmarking';

type SqlClient = ReturnType<typeof postgres>;

const settingsSchema = z.object({
  workspaceId: z.string().min(1),
  benchmarkingEnabled: z.boolean().optional(),
  industry: z.string().min(1).max(100).optional(),
  companySize: z.enum(['startup', 'smb', 'midmarket', 'enterprise']).optional(),
});

/**
 * Routes for workspace benchmarking: metrics collection and peer comparison.
 *
 * @param sql - Postgres client
 */
export function createWorkspaceBenchmarkingRoutes(sql: SqlClient) {
  const app = new Hono();
  const getSvc = () => new BenchmarkingService(sql);

  /** GET /benchmark-snapshot?workspaceId= — collect fresh metrics snapshot */
  app.get('/benchmark-snapshot', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const result = await getSvc().collectMetrics(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /benchmarks/peer-comparison?workspaceId=&industry=&companySize= */
  app.get('/benchmarks/peer-comparison', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const industry = c.req.query('industry');
    const companySizeRaw = c.req.query('companySize');
    const companySizeParsed = z.enum(['startup', 'smb', 'midmarket', 'enterprise']).safeParse(companySizeRaw);
    const companySize = companySizeParsed.success ? companySizeParsed.data : undefined;

    const result = await getSvc().getPeerBenchmarks(workspaceId, industry, companySize);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('No snapshot')) {
        return c.json({ error: { code: 'NO_SNAPSHOT', message: msg } }, 422);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /benchmarks/settings?workspaceId= */
  app.get('/benchmarks/settings', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const result = await getSvc().getSettings(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** PUT /benchmarks/settings */
  app.put('/benchmarks/settings', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { workspaceId, ...rawUpdates } = parsed.data;
    const updates = Object.fromEntries(
      Object.entries(rawUpdates).filter(([, v]) => v !== undefined),
    ) as Parameters<ReturnType<typeof getSvc>['updateSettings']>[1];
    const result = await getSvc().updateSettings(workspaceId, updates);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /benchmarks/export — opt-in anonymous export */
  app.post('/benchmarks/export', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({
      workspaceId: z.string().min(1),
      industry: z.string().min(1).max(100),
      companySize: z.enum(['startup', 'smb', 'midmarket', 'enterprise']),
    }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { workspaceId, industry, companySize } = parsed.data;
    const result = await getSvc().exportMetrics(workspaceId, industry, companySize);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('No snapshot')) {
        return c.json({ error: { code: 'NO_SNAPSHOT', message: msg } }, 422);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: { exported: true } });
  });

  return app;
}
