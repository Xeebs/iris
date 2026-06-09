import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { EntityLifecycleManager } from '@iris/semantic-core/entity-lifecycle';
import type { EntityStatus } from '@iris/semantic-core/entity-lifecycle';

const VALID_STATUSES: EntityStatus[] = ['DRAFT', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED'];

const StatusChangeSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED']),
  reason: z.string().min(1),
  actor: z.string().min(1),
  metadata: z.record(z.unknown()).optional().default({}),
});

const ApproveSchema = z.object({
  approverId: z.string().min(1),
  conditions: z.string().nullable().optional(),
});

const DeprecateSchema = z.object({
  actor: z.string().min(1),
  replacementEntityId: z.string().nullable().optional(),
  sunsetDate: z.string().datetime().nullable().optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/entities/:id/lifecycle
 */
export function makeEntityLifecycleRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const mgr = new EntityLifecycleManager(sql);

  // GET /:id/lifecycle — get status, history, approvals
  app.get('/:id/lifecycle', async (c) => {
    const entityId = c.req.param('id');
    const [historyResult, scoreResult] = await Promise.all([
      mgr.trackStatusHistory(entityId, 20),
      mgr.computeEntityHealthScore(entityId),
    ]);
    if (historyResult.isErr()) return c.json({ error: { code: 'db_error', message: historyResult.error.message } }, 500);
    return c.json({
      data: {
        entityId,
        history: historyResult.value,
        healthScore: scoreResult.isOk() ? scoreResult.value : null,
      },
    });
  });

  // PUT /:id/lifecycle/status — transition status
  app.put('/:id/lifecycle/status', async (c) => {
    const entityId = c.req.param('id');
    const parsed = StatusChangeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { status, reason, actor, metadata } = parsed.data;
    const result = await mgr.defineEntityStatus(entityId, status, reason, actor, metadata);
    if (result.isErr()) return c.json({ error: { code: 'lifecycle_error', message: result.error.message } }, 422);
    return c.json({ data: result.value });
  });

  // POST /:id/lifecycle/approve — record approval
  app.post('/:id/lifecycle/approve', async (c) => {
    const entityId = c.req.param('id');
    const parsed = ApproveSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await mgr.approveEntity(entityId, parsed.data.approverId, parsed.data.conditions ?? null);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  // POST /:id/lifecycle/deprecate — deprecate with optional replacement
  app.post('/:id/lifecycle/deprecate', async (c) => {
    const entityId = c.req.param('id');
    const parsed = DeprecateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { actor, replacementEntityId, sunsetDate } = parsed.data;
    const result = await mgr.deprecateEntity(entityId, actor, replacementEntityId ?? null, sunsetDate ? new Date(sunsetDate) : null);
    if (result.isErr()) return c.json({ error: { code: 'lifecycle_error', message: result.error.message } }, 422);
    return c.json({ data: result.value });
  });

  return app;
}

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/admin/lifecycle
 */
export function makeLifecycleAdminRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const mgr = new EntityLifecycleManager(sql);

  // GET /dashboard — summary of all entity lifecycle states
  app.get('/dashboard', async (c) => {
    const result = await mgr.getLifecycleDashboard();
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /entities — query entities by lifecycle status
  app.get('/entities', async (c) => {
    const status = c.req.query('status') as EntityStatus | undefined;
    if (status && !VALID_STATUSES.includes(status)) {
      return c.json({ error: { code: 'invalid_status', message: `status must be one of: ${VALID_STATUSES.join(', ')}` } }, 400);
    }
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const cursor = c.req.query('cursor') ?? undefined;
    const result = await mgr.queryEntitiesByLifecycle({ ...(status !== undefined ? { status } : {}), limit, ...(cursor !== undefined ? { cursor } : {}) });
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    const { states, nextCursor } = result.value;
    return c.json({ data: states, meta: { hasMore: nextCursor !== null, nextCursor } });
  });

  return app;
}
