import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { DataSubjectRequestHandler } from '@iris/semantic-core/dsr-handler';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'dsr' });

type SqlClient = ReturnType<typeof postgres>;

const createRequestSchema = z.object({
  subjectIdentifier: z.string().min(1),
  identifierType: z.enum(['email', 'user_id', 'pii']),
  requestType: z.enum(['access', 'erasure']),
});

/**
 * Factory for GDPR Data Subject Request routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /dsr
 */
export function createDsrRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const handler = new DataSubjectRequestHandler(
    sql as ConstructorParameters<typeof DataSubjectRequestHandler>[0],
  );

  /** POST /api/v1/dsr/request — submit a new DSR */
  app.post('/request', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const { subjectIdentifier, identifierType, requestType } = parsed.data;
    const result = await handler.create(workspaceId, subjectIdentifier, identifierType, requestType);
    if (result.isErr()) {
      log.error('Failed to create DSR', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create request' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/dsr/:requestId — get DSR status */
  app.get('/:requestId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { requestId } = c.req.param();
    const result = await handler.getById(requestId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve request' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'DSR not found' } }, 404);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/dsr/:requestId/execute — execute an access or erasure request */
  app.post('/:requestId/execute', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { requestId } = c.req.param();

    // Determine request type to pick the right execution path
    const dsrResult = await handler.getById(requestId, workspaceId);
    if (dsrResult.isErr() || !dsrResult.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'DSR not found' } }, 404);
    }

    const dsr = dsrResult.value;

    if (dsr.requestType === 'access') {
      const result = await handler.executeAccess(requestId, workspaceId);
      if (result.isErr()) {
        return c.json({ error: { code: 'EXECUTION_FAILED', message: result.error.message } }, 422);
      }
      return c.json({ data: result.value });
    } else {
      const result = await handler.executeErasure(requestId, workspaceId);
      if (result.isErr()) {
        return c.json({ error: { code: 'EXECUTION_FAILED', message: result.error.message } }, 422);
      }
      return c.json({ data: result.value });
    }
  });

  /** DELETE /api/v1/dsr/:requestId — cancel a pending erasure request */
  app.delete('/:requestId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { requestId } = c.req.param();
    const result = await handler.cancel(requestId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'CANCEL_FAILED', message: result.error.message } }, 422);
    }

    return c.json({ data: { cancelled: true } });
  });

  return app;
}
