import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { HaManager } from '@iris/semantic-core/ha-manager';

const FailoverSchema = z.object({
  fromRegion: z.string().min(1),
  toRegion: z.string().min(1),
  reason: z.enum(['manual', 'health_check_failure', 'replication_lag_exceeded']).default('manual'),
  confirmedBy: z.string().min(1),
});

const StatusUpdateSchema = z.object({
  regionId: z.string().min(1),
  primaryRegionId: z.string().min(1),
  lagMs: z.number().int().min(0).nullable(),
  status: z.enum(['healthy', 'degraded', 'unreachable']),
});

function workspaceId(c: { req: { header: (k: string) => string | undefined } }): string {
  return c.req.header('x-workspace-id') ?? 'default';
}

export function makeHaAdminRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const manager = new HaManager(sql);

  app.get('/status', async (c) => {
    const result = await manager.getStatus(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'STATUS_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.get('/history', async (c) => {
    const result = await manager.listFailoverHistory(workspaceId(c));
    if (result.isErr()) {
      return c.json({ error: { code: 'HISTORY_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  app.post('/failover', async (c) => {
    const parsed = FailoverSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { fromRegion, toRegion, reason, confirmedBy } = parsed.data;
    const result = await manager.recordFailover(workspaceId(c), fromRegion, toRegion, reason, confirmedBy);
    if (result.isErr()) {
      return c.json({ error: { code: 'FAILOVER_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  app.post('/replication-status', async (c) => {
    const parsed = StatusUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { regionId, primaryRegionId, lagMs, status } = parsed.data;
    const result = await manager.updateReplicationStatus(workspaceId(c), regionId, primaryRegionId, lagMs, status);
    if (result.isErr()) {
      return c.json({ error: { code: 'UPDATE_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: { ok: true } });
  });

  return app;
}
