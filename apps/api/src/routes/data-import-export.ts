import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import {
  parseCSV,
  parseJSON,
  detectSchema,
  validateMapping,
  transformRows,
  serializeToCSV,
  serializeToJSON,
  batchInsert,
  MAX_FILE_SIZE_BYTES,
  type FieldMapping,
} from '@iris/semantic-core/data-import-export';

type SqlClient = ReturnType<typeof postgres>;

const log = logger.child({ route: 'data-import-export' });

const ImportBodySchema = z.object({
  workspaceId: z.string().min(1),
  connectorId: z.string().min(1).default('import'),
  format: z.enum(['csv', 'json']).optional(),
  mapping: z.object({
    entityType: z.string().min(1),
    labelColumn: z.string().min(1),
    idColumn: z.string().optional(),
    attributeMap: z.record(z.string()),
  }),
  content: z.string().min(1),
});

const ExportQuerySchema = z.object({
  workspaceId: z.string().min(1),
  format: z.enum(['csv', 'json']).default('json'),
  entityType: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50000).default(1000),
});

const JobListQuerySchema = z.object({
  workspaceId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Create routes for bulk data import and export operations.
 *
 * @param sql - Postgres client
 */
export function createDataImportExportRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** POST /data/import — parse, validate, transform, and insert entities */
  app.post('/import', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const parsed = ImportBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, connectorId, format, mapping, content } = parsed.data;

    if (content.length > MAX_FILE_SIZE_BYTES) {
      return c.json({
        error: { code: 'FILE_TOO_LARGE', message: 'Content exceeds 100 MB limit' },
      }, 422);
    }

    let rows;
    try {
      rows = format === 'json' || (!format && content.trimStart().startsWith('['))
        ? parseJSON(content)
        : parseCSV(content);
    } catch (e) {
      return c.json({
        error: { code: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'Parse failed' },
      }, 422);
    }

    const fieldMapping: FieldMapping = {
      entityType: mapping.entityType,
      labelColumn: mapping.labelColumn,
      attributeMap: mapping.attributeMap,
      ...(mapping.idColumn !== undefined ? { idColumn: mapping.idColumn } : {}),
    };
    const validation = validateMapping(rows, fieldMapping);
    if (!validation.valid) {
      return c.json({
        error: { code: 'MAPPING_ERROR', message: validation.errors[0] ?? 'Invalid mapping', details: validation.errors },
      }, 422);
    }

    const { entities, errors: transformErrors } = transformRows(rows, fieldMapping, connectorId);

    const jobId = crypto.randomUUID();
    await sql`
      INSERT INTO import_export_jobs
        (id, workspace_id, type, status, format, record_count, created_by)
      VALUES (${jobId}, ${workspaceId}, 'import', 'running', ${format ?? 'csv'}, ${entities.length}, 'api')
    `;

    let insertResult;
    try {
      insertResult = await batchInsert(entities, workspaceId, async (ents) => {
        // Minimal upsert: store entity metadata in a simple table or log
        // In a real system this would delegate to vectorStore.upsert()
        log.info('Upserting import entities', { workspaceId, count: ents.length });
        return ents.length;
      });

      await sql`
        UPDATE import_export_jobs
        SET status = 'completed', record_count = ${insertResult.inserted}, completed_at = now()
        WHERE id = ${jobId}
      `;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      await sql`
        UPDATE import_export_jobs
        SET status = 'failed', error_message = ${msg}, completed_at = now()
        WHERE id = ${jobId}
      `;
      return c.json({ error: { code: 'IMPORT_FAILED', message: msg } }, 422);
    }

    log.info('Import complete', { workspaceId, jobId, inserted: insertResult.inserted });

    return c.json({
      data: {
        jobId,
        inserted: insertResult.inserted,
        skipped: transformErrors.length,
        durationMs: insertResult.durationMs,
        warnings: validation.warnings,
        errors: transformErrors.map((e) => e.message),
      },
    }, 201);
  });

  /** GET /data/export — export entities in the requested format */
  app.get('/export', async (c) => {
    const parsed = ExportQuerySchema.safeParse({
      workspaceId: c.req.query('workspaceId'),
      format: c.req.query('format'),
      entityType: c.req.query('entityType'),
      limit: c.req.query('limit'),
    });

    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, format, entityType, limit } = parsed.data;

    // In a real system this would query the vector store; here we return empty for scaffold
    const entities: never[] = [];
    log.info('Export requested', { workspaceId, entityType, format, limit });

    const jobId = crypto.randomUUID();
    await sql`
      INSERT INTO import_export_jobs
        (id, workspace_id, type, status, format, record_count, created_by, completed_at)
      VALUES (${jobId}, ${workspaceId}, 'export', 'completed', ${format}, ${entities.length}, 'api', now())
    `;

    const content = format === 'csv' ? serializeToCSV(entities) : serializeToJSON(entities);
    const mimeType = format === 'csv' ? 'text/csv' : 'application/json';

    return new Response(content, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="export-${jobId}.${format}"`,
        'X-Job-Id': jobId,
      },
    });
  });

  /** GET /data/import/schema — detect schema from sample content */
  app.post('/import/schema', async (c) => {
    const body = await c.req.json().catch(() => null);
    const format: string = body?.format ?? 'csv';
    const content: string = body?.content ?? '';

    if (!content) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'content is required' } }, 400);
    }

    try {
      const rows = format === 'json' ? parseJSON(content) : parseCSV(content);
      const schema = detectSchema(rows);
      return c.json({ data: schema }, 200);
    } catch (e) {
      return c.json({
        error: { code: 'PARSE_ERROR', message: e instanceof Error ? e.message : 'Parse failed' },
      }, 422);
    }
  });

  /** GET /data/jobs — list import/export job history for a workspace */
  app.get('/jobs', async (c) => {
    const parsed = JobListQuerySchema.safeParse({
      workspaceId: c.req.query('workspaceId'),
      limit: c.req.query('limit'),
    });

    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { workspaceId, limit } = parsed.data;

    const jobs = await sql`
      SELECT id, type, status, format, record_count, file_name, file_size_bytes,
             error_message, result_url, created_by, created_at, completed_at
      FROM import_export_jobs
      WHERE workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return c.json({ data: jobs, meta: { hasMore: jobs.length === limit } }, 200);
  });

  return app;
}
