import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { TransformationDSLEngine } from '@iris/semantic-core/transformation-dsl';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'transformations' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const transformationStepSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), from: z.string(), to: z.string() }),
  z.object({ op: z.literal('remove'), field: z.string() }),
  z.object({ op: z.literal('keep_only'), fields: z.array(z.string()).min(1) }),
  z.object({
    op: z.literal('normalize_case'),
    field: z.string(),
    mode: z.enum(['upper', 'lower', 'title']),
  }),
  z.object({ op: z.literal('trim'), field: z.string() }),
  z.object({
    op: z.literal('regex_replace'),
    field: z.string(),
    pattern: z.string(),
    replacement: z.string(),
    flags: z.string().optional(),
  }),
  z.object({
    op: z.literal('concat'),
    fields: z.array(z.string()).min(2),
    separator: z.string(),
    targetField: z.string(),
  }),
  z.object({
    op: z.literal('extract_substring'),
    field: z.string(),
    start: z.number().int(),
    end: z.number().int().optional(),
    targetField: z.string().optional(),
  }),
  z.object({
    op: z.literal('format_date'),
    field: z.string(),
    format: z.enum(['iso', 'short', 'epoch_ms']),
  }),
  z.object({
    op: z.literal('set_default'),
    field: z.string(),
    defaultValue: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
  z.object({
    op: z.literal('map_value'),
    field: z.string(),
    mapping: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    fallback: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  }),
]);

const createRuleSchema = z.object({
  connectorId: z.string().optional(),
  entityType: z.string().optional(),
  ruleName: z.string().min(1).max(100),
  steps: z.array(transformationStepSchema).min(1),
  isActive: z.boolean().default(true),
});

const testTransformationSchema = z.object({
  entity: z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])).default({}),
    relationships: z.array(z.unknown()).default([]),
    sourceId: z.string().optional(),
  }),
  steps: z.array(transformationStepSchema).min(1),
});

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * Factory for custom transformation pipeline routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /transformations
 */
export function createTransformationRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const engine = new TransformationDSLEngine(
    sql as unknown as ConstructorParameters<typeof TransformationDSLEngine>[0]
  );

  /** POST /api/v1/transformations/rules — create a transformation rule */
  app.post('/rules', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await engine.createRule({
      workspaceId,
      connectorId: parsed.data.connectorId,
      entityType: parsed.data.entityType,
      ruleName: parsed.data.ruleName,
      steps: parsed.data.steps as Parameters<typeof engine.createRule>[0]['steps'],
      isActive: parsed.data.isActive,
    });

    if (result.isErr()) {
      log.error('Failed to create transformation rule', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create rule' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/transformations/rules — list transformation rules */
  app.get('/rules', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const connectorId = c.req.query('connectorId') ?? undefined;
    const entityType = c.req.query('entityType') ?? undefined;

    const result = await engine.listRules(workspaceId, connectorId, entityType);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list rules' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/transformations/rules/:ruleId — delete a rule */
  app.delete('/rules/:ruleId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { ruleId } = c.req.param();
    const result = await engine.deleteRule(workspaceId, ruleId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete rule' } }, 500);
    }

    return c.json({ data: { deleted: true } });
  });

  /** POST /api/v1/transformations/test — preview transformation on sample entity */
  app.post('/test', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = testTransformationSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const entity = {
      ...parsed.data.entity,
      lastModified: new Date(),
      sourceId: parsed.data.entity.sourceId ?? parsed.data.entity.id,
      relationships: parsed.data.entity.relationships as never[],
    };

    const testResult = engine.testTransformation(entity, parsed.data.steps as Parameters<typeof engine.testTransformation>[1]);
    return c.json({ data: testResult });
  });

  return app;
}
