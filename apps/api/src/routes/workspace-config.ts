import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { parseConfigNL, NlpConfigService } from '@iris/semantic-core/nlp-config-parser';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'workspace-config' });

type SqlClient = ReturnType<typeof postgres>;

const parseBodySchema = z.object({
  workspaceId: z.string().min(1),
  text: z.string().min(1).max(2000),
  openAiKey: z.string().min(1),
  save: z.boolean().optional().default(true),
});

const listQuerySchema = z.object({
  workspaceId: z.string().min(1),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});

const approveBodySchema = z.object({
  approvedBy: z.string().min(1),
});

/**
 * @param sql - Postgres client
 */
export function createWorkspaceConfigRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const service = new NlpConfigService(sql);

  /**
   * POST /api/v1/workspace/config-from-language
   * Parse a natural language config statement and optionally save it.
   */
  routes.post('/config-from-language', async (c) => {
    const body = parseBodySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } },
        400,
      );
    }

    const { workspaceId, text, openAiKey, save } = body.data;

    const parseResult = await parseConfigNL(text, openAiKey);
    if (parseResult.isErr()) {
      log.error('NLP parse failed', { workspaceId, error: parseResult.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: parseResult.error.message } }, 500);
    }

    const parsed = parseResult.value;

    if (!save) {
      return c.json({ data: { parsed } }, 200);
    }

    const saveResult = await service.saveConfig(workspaceId, text, parsed);
    if (saveResult.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to save config' } }, 500);
    }

    return c.json({ data: { parsed, record: saveResult.value } }, 201);
  });

  /**
   * GET /api/v1/workspace/nlp-configs?workspaceId=&status=pending
   */
  routes.get('/nlp-configs', async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required', details: parsed.error.errors } },
        400,
      );
    }

    const result = await service.listConfigs(parsed.data.workspaceId, parsed.data.status);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list configs' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /**
   * PUT /api/v1/workspace/nlp-configs/:id/approve
   */
  routes.put('/nlp-configs/:id/approve', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = approveBodySchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'approvedBy is required', details: body.error.errors } },
        400,
      );
    }

    const id = c.req.param('id');
    const result = await service.approveConfig(workspaceId, id, body.data.approvedBy);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to approve config' } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: `Config "${id}" not found` } }, 404);
    }

    return c.json({ data: result.value });
  });

  return routes;
}
