import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { getAuth } from '@hono/clerk-auth';
import { WorkspaceDeletionService } from '@iris/semantic-core/workspace-deletion';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'workspace-deletion' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const requestDeletionSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
  retentionDays: z.number().int().min(7).max(365).optional(),
});

const updatePolicySchema = z.object({
  retentionDays: z.number().int().min(7).max(365).optional(),
  backupBeforeDeletion: z.boolean().optional(),
  legalHold: z.boolean().optional(),
});

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * @param sql - Postgres client
 * @returns Hono router mounted at /workspace/deletion
 */
export function createWorkspaceDeletionRoutes(sql: SqlClient): Hono {
  const app = new Hono();

  /** GET /workspace/deletion/status — get deletion status for current workspace */
  app.get('/status', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const svc = new WorkspaceDeletionService(sql);

    const result = await svc.getDeletionStatus(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    const policy = await svc.getPolicy(workspaceId);

    return c.json({
      data: {
        request: result.value,
        policy: policy.isOk() ? policy.value : null,
      },
    });
  });

  /** POST /workspace/deletion/request — request workspace deletion (30-day soft delete) */
  app.post('/request', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const userId: string = getAuth(c)?.userId ?? 'unknown';

    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = requestDeletionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const opts: import('@iris/semantic-core/workspace-deletion').RequestDeletionOptions = {};
    if (parsed.data.reason !== undefined) opts.reason = parsed.data.reason;
    if (parsed.data.retentionDays !== undefined) opts.retentionDays = parsed.data.retentionDays;

    const svc = new WorkspaceDeletionService(sql);
    const result = await svc.requestDeletion(workspaceId, userId, opts);

    if (result.isErr()) {
      const msg = result.error.message;
      const statusCode: ContentfulStatusCode =
        msg.includes('already pending') || msg.includes('legal hold') ? 409 : 500;
      return c.json({ error: { code: 'REQUEST_FAILED', message: msg } }, statusCode);
    }

    log.info('Deletion request submitted', { workspaceId, userId });
    return c.json({ data: result.value }, 201);
  });

  /** PUT /workspace/deletion/cancel — cancel a pending deletion request */
  app.put('/cancel', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const userId: string = getAuth(c)?.userId ?? 'unknown';

    const svc = new WorkspaceDeletionService(sql);
    const result = await svc.cancelDeletion(workspaceId, userId);

    if (result.isErr()) {
      const msg = result.error.message;
      const statusCode: ContentfulStatusCode = msg.includes('No cancellable') ? 404 : 500;
      return c.json({ error: { code: 'CANCEL_FAILED', message: msg } }, statusCode);
    }

    return c.json({ data: result.value });
  });

  /** GET /workspace/deletion/policy — get retention policy */
  app.get('/policy', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const svc = new WorkspaceDeletionService(sql);

    const result = await svc.getPolicy(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** PUT /workspace/deletion/policy — update retention policy */
  app.put('/policy', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;

    const body = await c.req.json().catch(() => null);
    if (!body) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body required' } }, 400);
    }

    const parsed = updatePolicySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const policyUpdate: Partial<import('@iris/semantic-core/workspace-deletion').DeletionPolicy> = {};
    if (parsed.data.retentionDays !== undefined) policyUpdate.retentionDays = parsed.data.retentionDays;
    if (parsed.data.backupBeforeDeletion !== undefined) policyUpdate.backupBeforeDeletion = parsed.data.backupBeforeDeletion;
    if (parsed.data.legalHold !== undefined) policyUpdate.legalHold = parsed.data.legalHold;

    const svc = new WorkspaceDeletionService(sql);
    const result = await svc.updatePolicy(workspaceId, policyUpdate);

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /workspace/deletion/execute — admin: permanently delete (grace period must have elapsed) */
  app.post('/execute', async (c) => {
    const workspaceId: string = c.get('workspaceId') as string;
    const userId: string = getAuth(c)?.userId ?? 'unknown';

    const svc = new WorkspaceDeletionService(sql);
    const result = await svc.permanentlyDelete(workspaceId, userId);

    if (result.isErr()) {
      const msg = result.error.message;
      let statusCode: ContentfulStatusCode = 500;
      if (msg.includes('No active')) statusCode = 404;
      if (msg.includes('Grace period')) statusCode = 422;
      return c.json({ error: { code: 'DELETE_FAILED', message: msg } }, statusCode);
    }

    return c.json({ data: { deleted: true, tableCounts: result.value } });
  });

  return app;
}
