import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { RetentionPolicyService } from '@iris/semantic-core/retention-manager';
import type { ArchiveAction } from '@iris/semantic-core/retention-manager';

const DefinePolicySchema = z.object({
  entityType: z.string().min(1),
  retentionDays: z.number().int().positive(),
  archiveAction: z.enum(['soft_delete', 'cold_storage', 'purge']),
  conditions: z.array(z.object({
    field: z.string().min(1),
    operator: z.enum(['in_top', 'older_than', 'not_accessed_since', 'has_tag']),
    value: z.union([z.string(), z.number()]),
  })).optional().default([]),
  description: z.string().optional().default(''),
});

const ArchiveSchema = z.object({
  reason: z.string().min(1),
  recoveryWindowDays: z.number().int().positive().optional().default(30),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/admin/retention-policies
 */
export function makeRetentionPoliciesRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const svc = new RetentionPolicyService(sql);

  // GET / — list all retention policies
  app.get('/', async (c) => {
    const result = await svc.listRetentionPolicies();
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // PUT /:type — upsert policy for entity type
  app.put('/:type', async (c) => {
    const entityType = c.req.param('type');
    const parsed = DefinePolicySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { retentionDays, archiveAction, conditions, description } = parsed.data;
    const result = await svc.defineRetentionPolicy(entityType, retentionDays, archiveAction as ArchiveAction, conditions as never, description);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /archived-entities — paginated archive browser
  app.get('/archived-entities', async (c) => {
    const entityType = c.req.query('entityType');
    const reason = c.req.query('reason');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const cursor = c.req.query('cursor') ?? undefined;
    const result = await svc.queryArchivedEntities({ entityType, reason, limit, cursor });
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    const { entities, nextCursor } = result.value;
    return c.json({ data: entities, meta: { hasMore: nextCursor !== null, nextCursor } });
  });

  // POST /archived-entities/:id/restore — restore entity
  app.post('/archived-entities/:id/restore', async (c) => {
    const entityId = c.req.param('id');
    const result = await svc.restoreArchivedEntity(entityId);
    if (result.isErr()) return c.json({ error: { code: 'restore_error', message: result.error.message } }, 422);
    return c.json({ data: { restored: true, entityId } });
  });

  // POST /archived-entities/:id/archive — archive entity manually
  app.post('/entities/:id/archive', async (c) => {
    const entityId = c.req.param('id');
    const parsed = ArchiveSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await svc.archiveEntity(entityId, parsed.data.reason, parsed.data.recoveryWindowDays);
    if (result.isErr()) return c.json({ error: { code: 'archive_error', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  // POST /run-archival-job — trigger batch archival
  app.post('/run-archival-job', async (c) => {
    const result = await svc.runArchivalJobScheduled();
    if (result.isErr()) return c.json({ error: { code: 'job_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
