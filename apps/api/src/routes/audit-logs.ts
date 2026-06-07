import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { AuditLogService } from '@iris/semantic-core/audit-log-service';
import type { AuditAction } from '@iris/semantic-core/audit-log-service';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'audit-logs' });

type SqlClient = ReturnType<typeof postgres>;

const VALID_ACTIONS: AuditAction[] = [
  'entity_read', 'entity_write', 'config_change',
  'permission_change', 'connector_sync', 'dsr_executed', 'login', 'logout',
];

const querySchema = z.object({
  action: z.enum(VALID_ACTIONS as [AuditAction, ...AuditAction[]]).optional(),
  actorId: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * Factory for audit log routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /admin/audit-logs
 */
export function createAuditLogRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const auditService = new AuditLogService(
    sql as ConstructorParameters<typeof AuditLogService>[0],
  );

  /** GET /api/v1/admin/audit-logs — query logs with filters */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const query = querySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const { action, actorId, resourceType, resourceId, startDate, endDate, cursor, limit } = query.data;

    const result = await auditService.queryLogs(workspaceId, {
      ...(action ? { action } : {}),
      ...(actorId ? { actorId } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(startDate ? { startDate: new Date(startDate) } : {}),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
      ...(cursor ? { cursor } : {}),
      limit,
    });

    if (result.isErr()) {
      log.error('Failed to query audit logs', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to query logs' } }, 500);
    }

    const { logs, nextCursor, hasMore } = result.value;
    return c.json({
      data: logs,
      meta: { nextCursor, hasMore },
    });
  });

  /** GET /api/v1/admin/audit-logs/export — download as JSON or CSV */
  app.get('/export', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const format = c.req.query('format') === 'csv' ? 'csv' : 'json';

    const result = await auditService.exportLogs(workspaceId, format);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Export failed' } }, 500);
    }

    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const filename = `audit-logs-${workspaceId}-${new Date().toISOString().slice(0, 10)}.${format}`;

    return new Response(result.value, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  return app;
}
