import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { BatchOperations, validateBatch } from '@iris/semantic-core/batch-operations';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'bulk-operations' });

const ExportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  type: z.string().optional(),
  updatedAfter: z.string().datetime().optional(),
});

const ImportBodySchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
  fileName: z.string().optional(),
  data: z.string().min(1),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createBulkOperationsRoutes(sql: Sql): Hono {
  const router = new Hono();
  const ops = new BatchOperations(sql as never);

  router.post('/import', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const parsed = ImportBodySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.format() } },
        400,
      );
    }

    const { format, fileName, data } = parsed.data;

    let rawRecords: ReturnType<BatchOperations['parseImportFile']>;
    try {
      rawRecords = ops.parseImportFile(data, format);
    } catch (e) {
      return c.json(
        { error: { code: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'Failed to parse import file' } },
        400,
      );
    }

    const { valid, errors: validationErrors } = validateBatch(rawRecords);
    if (valid.length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No valid records found',
            details: validationErrors,
          },
        },
        400,
      );
    }

    log.info('Starting bulk import', { workspaceId, format, totalRecords: rawRecords.length, validCount: valid.length });

    const result = await ops.importBatch(workspaceId, valid);

    // Persist job record
    try {
      await sql`
        INSERT INTO import_jobs
          (job_id, workspace_id, file_name, format, record_count, imported_count, error_count, errors_json, status, completed_at)
        VALUES (
          ${result.jobId},
          ${workspaceId},
          ${fileName ?? `import-${Date.now()}`},
          ${format},
          ${result.totalRecords},
          ${result.importedCount},
          ${result.errorCount},
          ${JSON.stringify(result.errors)}::jsonb,
          ${result.status},
          NOW()
        )
      `;
    } catch (e) {
      log.warn('Failed to persist import job record', { jobId: result.jobId, error: String(e) });
    }

    return c.json({ data: result }, result.status === 'failed' ? 422 : 201);
  });

  router.get('/import/jobs', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    try {
      const rows = await sql`
        SELECT job_id, file_name, format, record_count, imported_count, error_count, status, created_at, completed_at
        FROM import_jobs
        WHERE workspace_id = ${workspaceId}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return c.json({ data: rows });
    } catch (e) {
      log.error('Failed to fetch import jobs', { workspaceId, error: String(e) });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch import jobs' } }, 500);
    }
  });

  router.get('/import/jobs/:jobId', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const jobId = c.req.param('jobId');
    const rows = await sql`
      SELECT * FROM import_jobs
      WHERE job_id = ${jobId} AND workspace_id = ${workspaceId}
    `;
    if (rows.length === 0) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Import job not found' } }, 404);
    }
    return c.json({ data: rows[0] });
  });

  router.get('/export', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const parsed = ExportQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.format() } },
        400,
      );
    }

    const { format, type, updatedAfter } = parsed.data;
    log.info('Starting entity export', { workspaceId, format, type, updatedAfter });

    const content = await ops.exportBatch(
      workspaceId,
      {
        entityType: type,
        updatedAfter: updatedAfter ? new Date(updatedAfter) : undefined,
      },
      format,
    );

    const mimeType = format === 'csv' ? 'text/csv' : 'application/json';
    const fileName = `entities-export-${Date.now()}.${format}`;

    return new Response(content, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-cache',
      },
    });
  });

  return router;
}
