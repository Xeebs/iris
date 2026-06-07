import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { EntityAuditService } from '@iris/semantic-core/entity-audit-service';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'entity-audit' });
type SqlClient = ReturnType<typeof postgres>;

const historyQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

const listQuerySchema = z.object({
  entityType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});


/**
 * Routes for entity audit trail queries.
 * Mounted under /api/v1/entity-audit
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createEntityAuditRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const auditService = new EntityAuditService(sql as ConstructorParameters<typeof EntityAuditService>[0]);

  /** GET /api/v1/entity-audit/events — list recent events for the workspace */
  app.get('/events', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const query = listQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const result = await auditService.listRecentEvents(workspaceId, query.data.entityType, query.data.limit);
    if (result.isErr()) {
      log.error('Failed to list audit events', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list audit events' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/entity-audit/entities/:entityId/history — full change history for one entity */
  app.get('/entities/:entityId/history', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { entityId } = c.req.param();
    const query = historyQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const timeRange = (query.data.from ?? query.data.to)
      ? {
          ...(query.data.from !== undefined ? { from: query.data.from } : {}),
          ...(query.data.to !== undefined ? { to: query.data.to } : {}),
        }
      : undefined;

    const result = await auditService.getHistory(workspaceId, entityId, timeRange, query.data.limit);
    if (result.isErr()) {
      log.error('Failed to get entity history', { workspaceId, entityId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve entity history' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/entity-audit/entities/:entityId/fields/:fieldName — value timeline for a field */
  app.get('/entities/:entityId/fields/:fieldName', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { entityId, fieldName } = c.req.param();
    const result = await auditService.getFieldHistory(workspaceId, entityId, fieldName);
    if (result.isErr()) {
      log.error('Failed to get field history', { workspaceId, entityId, fieldName, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve field history' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/entity-audit/anomalies — detect anomalous patterns in the workspace */
  app.get('/anomalies', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const lookbackDays = parseInt(c.req.query('lookbackDays') ?? '7', 10);
    if (isNaN(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'lookbackDays must be 1-90' } }, 400);
    }

    const result = await auditService.detectAnomalies(workspaceId, lookbackDays);
    if (result.isErr()) {
      log.error('Anomaly detection failed', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Anomaly detection failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/entity-audit/entities/:entityId/track — manually track a change */
  app.post('/entities/:entityId/track', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { entityId } = c.req.param();
    const bodySchema = z.object({
      entityType: z.string().min(1),
      changeType: z.enum(['created', 'updated', 'deleted']),
      changedBy: z.enum(['connector_sync', 'webhook', 'user_import', 'manual']),
      sourceConnectorId: z.string().optional(),
      oldValues: z.record(z.unknown()).optional(),
      newValues: z.record(z.unknown()).optional(),
    });

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await c.req.json());
    } catch (e) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400);
    }

    const result = await auditService.trackChange(
      workspaceId,
      entityId,
      body.entityType,
      body.changeType,
      body.changedBy,
      {
        ...(body.sourceConnectorId !== undefined ? { sourceConnectorId: body.sourceConnectorId } : {}),
        ...(body.oldValues !== undefined ? { oldValues: body.oldValues } : {}),
        ...(body.newValues !== undefined ? { newValues: body.newValues } : {}),
      },
    );

    if (result.isErr()) {
      log.error('Failed to track entity change', { workspaceId, entityId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to record change' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  return app;
}
