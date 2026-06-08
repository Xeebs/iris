import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '@iris/core/logger';
import { PiiMaskingAuditService, applyMaskPreview } from '@iris/semantic-core/pii-masking-audit';
import type { Sql } from 'postgres';

const log = logger.child({ service: 'pii-masking-audit-routes' });

const MaskStrategySchema = z.enum(['redact', 'hash', 'tokenize', 'keep_last_4', 'none']);

const SetStrategyBody = z.object({
  strategy: MaskStrategySchema,
});

const BulkRuleBody = z.object({
  fieldPattern: z.string().min(1),
  strategy: MaskStrategySchema,
  applyToAllConnectors: z.boolean().default(false),
  connectorIds: z.array(z.string()).default([]),
});

const PreviewBody = z.object({
  value: z.string().min(1),
  strategy: MaskStrategySchema,
});

const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/**
 * @param sql - Postgres tagged-template SQL function
 */
export function createPiiMaskingAuditRoutes(sql: Sql): Hono {
  const router = new Hono();
  const service = new PiiMaskingAuditService(sql as never);

  /** GET /admin/pii-access-audit — paginated PII access log */
  router.get('/access-audit', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const query = AuditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params' } }, 400);
    }

    const result = await service.listAccessEvents(workspaceId, query.data.limit, query.data.cursor);
    if (result.isErr()) {
      log.error('Failed to list PII access events', { error: result.error });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    const { events, nextCursor, hasMore } = result.value;
    return c.json({ data: events, meta: { nextCursor, hasMore } });
  });

  /** GET /admin/pii-fields/:workspaceId — list all field mask rules */
  router.get('/fields', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const result = await service.listFieldRules(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** PUT /admin/pii-fields/:connectorId/:fieldName/strategy — set mask strategy for a field */
  router.put('/fields/:connectorId/:fieldName/strategy', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const connectorId = c.req.param('connectorId');
    const fieldName = c.req.param('fieldName');

    const body = SetStrategyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 400);
    }

    const result = await service.setFieldStrategy(workspaceId, connectorId, fieldName, body.data.strategy);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /admin/pii-fields/bulk-rule — apply a bulk mask rule by pattern */
  router.post('/fields/bulk-rule', async (c) => {
    const workspaceId = c.req.header('x-workspace-id') ?? 'default';
    const body = BulkRuleBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: body.error.format() } }, 400);
    }

    const { fieldPattern, strategy, applyToAllConnectors, connectorIds } = body.data;
    const result = await service.applyBulkRule(workspaceId, connectorIds, { fieldPattern, strategy, applyToAllConnectors });
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    log.info('Bulk PII rule applied', { workspaceId, fieldPattern, strategy, rulesUpdated: result.value });
    return c.json({ data: { rulesUpdated: result.value } });
  });

  /** POST /admin/pii-fields/preview — preview masking output for a value */
  router.post('/fields/preview', async (c) => {
    const body = PreviewBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } }, 400);
    }
    return c.json({
      data: {
        original: body.data.value,
        masked: applyMaskPreview(body.data.value, body.data.strategy),
        strategy: body.data.strategy,
      },
    });
  });

  return router;
}
