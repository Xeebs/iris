import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { GlossaryService } from '@iris/semantic-core/glossary';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'glossary' });

type SqlClient = ReturnType<typeof postgres>;

const addTermSchema = z.object({
  term: z.string().min(1).max(200),
  definition: z.string().min(1),
  exampleValue: z.string().optional(),
  changedBy: z.string().optional(),
});

const querySchema = z.object({
  workspaceId: z.string().min(1),
  filter: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const approveSchema = z.object({
  approvedBy: z.string().min(1),
});

/**
 * @param sql - Postgres client
 */
export function createGlossaryRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const service = new GlossaryService(sql);

  /** GET /api/v1/glossary?workspaceId=&filter=&status= */
  routes.get('/', async (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.errors } },
        400,
      );
    }
    const { workspaceId, filter, status } = parsed.data;
    const result = await service.listTerms(workspaceId, filter, status);
    if (result.isErr()) {
      log.error('Failed to list glossary terms', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list glossary terms' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /api/v1/glossary/usage?workspaceId= */
  routes.get('/usage', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const result = await service.getTermUsage(workspaceId);
    if (result.isErr()) {
      log.error('Failed to get glossary usage', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get glossary usage' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/glossary?workspaceId= */
  routes.post('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = addTermSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
        400,
      );
    }

    const result = await service.addTerm(
      workspaceId,
      body.data.term,
      body.data.definition,
      body.data.exampleValue,
      body.data.changedBy,
    );
    if (result.isErr()) {
      log.error('Failed to add glossary term', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to add glossary term' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/glossary/:term/history?workspaceId= */
  routes.get('/:term/history', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const term = c.req.param('term');
    const result = await service.getTermHistory(workspaceId, term);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get term history' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** PUT /api/v1/glossary/:term/approve?workspaceId= */
  routes.put('/:term/approve', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const term = c.req.param('term');

    const body = approveSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'approvedBy is required', details: body.error.errors } },
        400,
      );
    }

    const result = await service.approveTerm(workspaceId, term, body.data.approvedBy);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to approve term' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Term "${term}" not found` } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/glossary/:term?workspaceId= */
  routes.delete('/:term', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }
    const term = c.req.param('term');
    const result = await service.deleteTerm(workspaceId, term);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete glossary term' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Term "${term}" not found` } }, 404);
    }
    return c.json({ data: { deleted: true } });
  });

  return routes;
}
