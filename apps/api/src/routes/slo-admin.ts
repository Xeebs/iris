import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { SloService } from '@iris/semantic-core/slo-monitor';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'slo-admin' });

const DefineSloBody = z.object({
  name: z.string().min(1).max(100),
  metric: z.string().min(1),
  target: z.number().min(0).max(1),
  windowHours: z.number().int().min(1).max(720).default(24),
  severity: z.enum(['warning', 'critical']).default('warning'),
});

const RecordEventBody = z.object({
  sloName: z.string().min(1),
  metricValue: z.number(),
  met: z.boolean(),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createSloAdminRoutes(sql: Sql): Hono {
  const router = new Hono();
  const service = new SloService(sql as never);

  /** GET /admin/slos — list all SLOs with current attainment */
  router.get('/', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const result = await service.calculateAttainments(workspaceId);
    if (result.isErr()) {
      log.error('Failed to calculate SLO attainments', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /admin/slos — define or update an SLO */
  router.post('/', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = DefineSloBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid SLO definition', details: body.error.format() } }, 400);
    }

    const result = await service.defineSlo({ ...body.data, workspaceId, active: true });
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { name: body.data.name, message: 'SLO defined' } }, 201);
  });

  /** GET /admin/slos/violations — list historical violations */
  router.get('/violations', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const result = await service.listViolations(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /admin/slos/detect — run violation detection (typically called by a scheduler) */
  router.post('/detect', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const result = await service.detectViolations(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { violationsDetected: result.value.length, violations: result.value } });
  });

  /** POST /admin/slos/events — record a metric observation */
  router.post('/events', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = RecordEventBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid event body' } }, 400);
    }

    const result = await service.recordEvent(body.data.sloName, workspaceId, body.data.metricValue, body.data.met);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { recorded: true } });
  });

  return router;
}
