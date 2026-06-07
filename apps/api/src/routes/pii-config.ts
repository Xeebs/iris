import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { PiiConfigService } from '@iris/semantic-core/pii-masker';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'pii-config' });

type SqlClient = ReturnType<typeof postgres>;

const workspaceQuery = z.object({ workspaceId: z.string().min(1) });

const upsertConfigSchema = z.object({
  enableAutoDetection: z.boolean(),
  defaultStrategy: z.enum(['redact', 'hash', 'tokenize']),
  tokenizationKey: z.string().min(16).optional(),
});

const upsertFieldSchema = z.object({
  fieldName: z.string().min(1),
  strategy: z.enum(['redact', 'hash', 'tokenize']),
  customPattern: z.string().optional(),
});

const deleteFieldSchema = z.object({ fieldName: z.string().min(1) });

/**
 * @param sql - Postgres client
 */
export function createPiiConfigRoutes(sql: SqlClient): Hono {
  const routes = new Hono();
  const service = new PiiConfigService(sql);

  /** GET /api/v1/pii-config?workspaceId= */
  routes.get('/', async (c) => {
    const parsed = workspaceQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const { workspaceId } = parsed.data;
    const result = await service.getConfig(workspaceId);

    if (result.isErr()) {
      log.error('Failed to get PII config', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get PII config' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** PUT /api/v1/pii-config?workspaceId= — upsert workspace-level config */
  routes.put('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = upsertConfigSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } }, 400);
    }

    const { enableAutoDetection, defaultStrategy, tokenizationKey } = body.data;
    const result = await service.upsertConfig(workspaceId, enableAutoDetection, defaultStrategy, tokenizationKey);

    if (result.isErr()) {
      log.error('Failed to upsert PII config', { workspaceId, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update PII config' } }, 500);
    }

    log.info('PII config updated', { workspaceId, enableAutoDetection, defaultStrategy });
    return c.json({ data: { ok: true } });
  });

  /** POST /api/v1/pii-config/fields?workspaceId= — add or update a field override */
  routes.post('/fields', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = upsertFieldSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.errors } }, 400);
    }

    const { fieldName, strategy, customPattern } = body.data;
    const result = await service.upsertFieldConfig(workspaceId, fieldName, strategy, customPattern);

    if (result.isErr()) {
      log.error('Failed to upsert PII field config', { workspaceId, fieldName, error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update field config' } }, 500);
    }

    log.info('PII field config updated', { workspaceId, fieldName, strategy });
    return c.json({ data: { ok: true } }, 201);
  });

  /** DELETE /api/v1/pii-config/fields?workspaceId= */
  routes.delete('/fields', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required' } }, 400);
    }

    const body = deleteFieldSchema.safeParse(await c.req.json());
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'fieldName is required' } }, 400);
    }

    const result = await service.deleteFieldConfig(workspaceId, body.data.fieldName);

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete field config' } }, 500);
    }

    return c.json({ data: { deleted: result.value } });
  });

  return routes;
}
