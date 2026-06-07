import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';
import { SyncJobQueue } from '@iris/queue';
import { SyncJobDlqService } from '../services/dlq-service.js';

const log = logger.child({ route: 'admin-dlq' });

type SqlClient = ReturnType<typeof postgres>;

const listQuerySchema = z.object({
  workspaceId: z.string().optional(),
  connectorInstanceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const retryBodySchema = z.object({
  retriedBy: z.string().min(1).default('admin'),
});

/**
 * @param sql - Postgres client for DLQ reads/writes
 * @param redisUrl - Redis URL for re-enqueueing retried jobs
 * @returns Hono router mounted at /admin/dlq
 */
export function createAdminDlqRoutes(sql: SqlClient, redisUrl: string): Hono {
  const app = new Hono();
  const syncQueue = new SyncJobQueue(redisUrl);
  const dlqService = new SyncJobDlqService(sql, syncQueue);

  app.get('/', async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { workspaceId, connectorInstanceId, limit, cursor } = parsed.data;

    const listOpts = {
      limit,
      ...(workspaceId ? { workspaceId } : {}),
      ...(connectorInstanceId ? { connectorInstanceId } : {}),
      ...(cursor ? { cursor } : {}),
    };
    const result = await dlqService.listJobs(listOpts);
    if (result.isErr()) {
      log.error('Failed to list DLQ jobs', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list DLQ jobs' } }, 500);
    }

    const { entries, hasMore } = result.value;
    const nextCursor = hasMore && entries.length > 0 ? entries[entries.length - 1]!.id : undefined;

    return c.json({
      data: entries,
      meta: { hasMore, ...(nextCursor ? { nextCursor } : {}) },
    });
  });

  app.post('/:jobId/retry', async (c) => {
    const dlqId = c.req.param('jobId');
    if (!dlqId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'jobId is required' } }, 400);
    }

    let body: { retriedBy: string } = { retriedBy: 'admin' };
    try {
      const raw = await c.req.json() as unknown;
      const parsed = retryBodySchema.safeParse(raw);
      if (parsed.success) body = parsed.data;
    } catch {
      // JSON parse failure — use defaults
    }

    const result = await dlqService.retryJob(dlqId, body.retriedBy);
    if (result.isErr()) {
      const msg = result.error.message;
      const isNotFound = msg.includes('not found');
      const isAlreadyRetried = msg.includes('already been retried');
      if (isNotFound) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      if (isAlreadyRetried) {
        return c.json({ error: { code: 'CONFLICT', message: msg } }, 409);
      }
      log.error('Failed to retry DLQ job', { dlqId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retry job' } }, 500);
    }

    return c.json({ data: { newJobId: result.value.newJobId, dlqId } }, 200);
  });

  return app;
}
