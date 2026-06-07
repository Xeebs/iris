import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { DataExporter } from '@iris/semantic-core';
import type { WorkspaceExport } from '@iris/semantic-core';

const log = logger.child({ route: 'admin-backup' });

type SqlClient = ReturnType<typeof postgres>;

const importBodySchema = z.object({
  targetWorkspaceId: z.string().min(1),
  backup: z.object({
    version: z.literal('1.0'),
    exportedAt: z.string(),
    workspaceId: z.string(),
    exportType: z.enum(['full', 'entities', 'schema']),
    entities: z.array(z.unknown()),
    glossaryTerms: z.array(z.unknown()),
    metrics: z.array(z.unknown()),
    relationships: z.array(z.unknown()),
    schemaDefinitions: z.array(z.unknown()),
    entityCount: z.number(),
  }),
});

const listAdminJobsSchema = z.object({
  workspaceId: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /admin/backup
 */
export function createAdminBackupRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const exporter = new DataExporter(sql);

  /** POST /admin/backup/import — restore a workspace backup (admin only) */
  app.post('/import', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = importBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { targetWorkspaceId, backup } = parsed.data;

    log.info('Admin initiating workspace import', {
      sourceWorkspaceId: backup.workspaceId,
      targetWorkspaceId,
    });

    const result = await exporter.importWorkspace(backup as WorkspaceExport, targetWorkspaceId);
    if (result.isErr()) {
      log.error('Workspace import failed', { targetWorkspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value }, 200);
  });

  /** GET /admin/backup/jobs — list all export jobs across workspaces */
  app.get('/jobs', async (c) => {
    const parsed = listAdminJobsSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, status, limit, cursor } = parsed.data;

    try {
      const wsFilter = workspaceId ?? null;
      const statusFilter = status ?? null;

      const rows = cursor
        ? await sql`
            SELECT id, workspace_id, status, export_type, progress_pct, entity_count,
                   error_message, created_at, started_at, completed_at
            FROM export_jobs
            WHERE (${wsFilter}::text IS NULL OR workspace_id = ${wsFilter}::text)
              AND (${statusFilter}::text IS NULL OR status = ${statusFilter}::text)
              AND created_at < (SELECT created_at FROM export_jobs WHERE id = ${cursor})
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `
        : await sql`
            SELECT id, workspace_id, status, export_type, progress_pct, entity_count,
                   error_message, created_at, started_at, completed_at
            FROM export_jobs
            WHERE (${wsFilter}::text IS NULL OR workspace_id = ${wsFilter}::text)
              AND (${statusFilter}::text IS NULL OR status = ${statusFilter}::text)
            ORDER BY created_at DESC
            LIMIT ${limit + 1}
          `;

      const hasMore = rows.length > limit;
      const jobs = rows.slice(0, limit);
      const nextCursor = hasMore && jobs.length > 0 ? (jobs[jobs.length - 1] as { id: string }).id : undefined;

      return c.json({
        data: jobs.map((r) => {
          const row = r as AdminJobRow;
          return {
            id: row.id,
            workspaceId: row.workspace_id,
            status: row.status,
            exportType: row.export_type,
            progressPct: row.progress_pct,
            entityCount: row.entity_count,
            errorMessage: row.error_message,
            createdAt: row.created_at,
            startedAt: row.started_at,
            completedAt: row.completed_at,
          };
        }),
        meta: { hasMore, ...(nextCursor ? { nextCursor } : {}) },
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Failed to list admin backup jobs', { error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list jobs' } }, 500);
    }
  });

  return app;
}

interface AdminJobRow {
  id: string;
  workspace_id: string;
  status: string;
  export_type: string;
  progress_pct: number;
  entity_count: number | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}
