import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { DataExporter } from '@iris/semantic-core';

const log = logger.child({ route: 'workspace-export' });

type SqlClient = ReturnType<typeof postgres>;

const exportEntitiesSchema = z.object({
  entityTypes: z.array(z.string()).optional(),
  connectorInstanceId: z.string().uuid().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

const fullExportSchema = exportEntitiesSchema.extend({
  includeGlossary: z.boolean().default(true),
  includeMetrics: z.boolean().default(true),
  includeRelationships: z.boolean().default(true),
  includeConfigs: z.boolean().default(false),
});

const listJobsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /workspace/export
 */
export function createWorkspaceExportRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const exporter = new DataExporter(sql);

  /** POST /workspace/export/full — trigger a full workspace backup */
  app.post('/full', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const body = await c.req.json().catch(() => ({}));
    const parsed = fullExportSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const options = {
      ...parsed.data,
      since: parsed.data.since ? new Date(parsed.data.since) : undefined,
      until: parsed.data.until ? new Date(parsed.data.until) : undefined,
    };

    const result = await exporter.createExportJob(workspaceId, 'full', options);
    if (result.isErr()) {
      log.error('Failed to create full export job', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to start export' } }, 500);
    }

    return c.json({ data: { jobId: result.value, status: 'pending' } }, 201);
  });

  /** POST /workspace/export/entities — trigger filtered entity export */
  app.post('/entities', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const body = await c.req.json().catch(() => ({}));
    const parsed = exportEntitiesSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const options = {
      ...parsed.data,
      since: parsed.data.since ? new Date(parsed.data.since) : undefined,
      until: parsed.data.until ? new Date(parsed.data.until) : undefined,
    };

    const result = await exporter.createExportJob(workspaceId, 'entities', options);
    if (result.isErr()) {
      log.error('Failed to create entity export job', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to start export' } }, 500);
    }

    return c.json({ data: { jobId: result.value, status: 'pending' } }, 201);
  });

  /** POST /workspace/export/schema — export schema definitions */
  app.post('/schema', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;

    const result = await exporter.createExportJob(workspaceId, 'schema');
    if (result.isErr()) {
      log.error('Failed to create schema export job', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to start export' } }, 500);
    }

    return c.json({ data: { jobId: result.value, status: 'pending' } }, 201);
  });

  /** GET /workspace/export/jobs — list export jobs for this workspace */
  app.get('/jobs', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const parsed = listJobsSchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await exporter.listExportJobs(workspaceId, parsed.data.limit, parsed.data.cursor);
    if (result.isErr()) {
      log.error('Failed to list export jobs', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list export jobs' } }, 500);
    }

    const { jobs, hasMore } = result.value;
    const nextCursor = hasMore && jobs.length > 0 ? jobs[jobs.length - 1]!.id : undefined;

    return c.json({
      data: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        exportType: j.exportType,
        progressPct: j.progressPct,
        entityCount: j.entityCount,
        errorMessage: j.errorMessage,
        createdAt: j.createdAt,
        completedAt: j.completedAt,
      })),
      meta: { hasMore, ...(nextCursor ? { nextCursor } : {}) },
    });
  });

  /** GET /workspace/export/jobs/:jobId — get status + download link for a job */
  app.get('/jobs/:jobId', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const jobId = c.req.param('jobId');

    const result = await exporter.getExportJob(jobId, workspaceId);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: 'Export job not found' } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }

    const job = result.value;
    return c.json({
      data: {
        id: job.id,
        status: job.status,
        exportType: job.exportType,
        progressPct: job.progressPct,
        entityCount: job.entityCount,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        // Only include resultData when complete to avoid large payloads on status checks
        ...(job.status === 'completed' && job.resultData ? { resultData: job.resultData } : {}),
      },
    });
  });

  return app;
}
