import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { EntityValidationEngine } from '@iris/semantic-core/entity-validator';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'entity-validation' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Validation schemas ───────────────────────────────────────────────────────

const crossFieldConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['eq', 'neq', 'exists', 'not_exists']),
  value: z.unknown().optional(),
});

const crossFieldRequirementSchema = z.object({
  field: z.string(),
  operator: z.enum(['exists', 'not_exists', 'eq', 'neq']),
  value: z.unknown().optional(),
  message: z.string().optional(),
});

const ruleDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('required'), field: z.string() }),
  z.object({
    type: z.literal('type'),
    field: z.string(),
    expectedType: z.enum(['string', 'number', 'boolean', 'array']),
  }),
  z.object({ type: z.literal('regex'), field: z.string(), pattern: z.string(), flags: z.string().optional() }),
  z.object({
    type: z.literal('cross_field'),
    condition: crossFieldConditionSchema,
    requirement: crossFieldRequirementSchema,
  }),
  z.object({ type: z.literal('email'), field: z.string() }),
  z.object({ type: z.literal('phone'), field: z.string() }),
  z.object({ type: z.literal('min_length'), field: z.string(), minLength: z.number().int().positive() }),
  z.object({ type: z.literal('max_length'), field: z.string(), maxLength: z.number().int().positive() }),
  z.object({ type: z.literal('enum'), field: z.string(), allowedValues: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('range'), field: z.string(), min: z.number().optional(), max: z.number().optional() }),
]);

const createRuleSchema = z.object({
  entityType: z.string().min(1),
  ruleName: z.string().min(1).max(100),
  definition: ruleDefinitionSchema,
  isBlocking: z.boolean().default(true),
  severity: z.enum(['error', 'warning']).default('error'),
});

const validateEntitySchema = z.object({
  entity: z.object({
    id: z.string(),
    type: z.string(),
    label: z.string(),
    attributes: z.record(z.unknown()).default({}),
    relationships: z.array(z.unknown()).default([]),
    lastModified: z.string().optional(),
    sourceId: z.string().optional(),
  }),
});

const listRulesQuerySchema = z.object({
  entityType: z.string().optional(),
});

const listFailuresQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  acknowledged: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  ruleId: z.string().uuid().optional(),
});

// ─── Route factory ────────────────────────────────────────────────────────────

/**
 * Factory for entity validation routes.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted under /validation
 */
export function createEntityValidationRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const engine = new EntityValidationEngine(
    sql as unknown as ConstructorParameters<typeof EntityValidationEngine>[0]
  );

  /** POST /api/v1/validation/rules — create a new validation rule */
  app.post('/rules', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.get('userId' as never) as string | undefined;
    if (!workspaceId || !userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = createRuleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await engine.createRule({
      workspaceId,
      entityType: parsed.data.entityType,
      ruleName: parsed.data.ruleName,
      definition: parsed.data.definition as Parameters<typeof engine.createRule>[0]['definition'],
      isBlocking: parsed.data.isBlocking,
      severity: parsed.data.severity,
      createdByUserId: userId,
    });

    if (result.isErr()) {
      log.error('Failed to create validation rule', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create rule' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/validation/rules — list validation rules */
  app.get('/rules', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const query = listRulesQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const result = await engine.listRules(workspaceId, query.data.entityType);
    if (result.isErr()) {
      log.error('Failed to list rules', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list rules' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/validation/rules/:ruleId — delete a validation rule */
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

  /** POST /api/v1/validation/validate-entity — test rules against a sample entity */
  app.post('/validate-entity', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = validateEntitySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const entity = {
      ...parsed.data.entity,
      lastModified: parsed.data.entity.lastModified
        ? new Date(parsed.data.entity.lastModified)
        : new Date(),
      sourceId: parsed.data.entity.sourceId ?? parsed.data.entity.id,
      relationships: (parsed.data.entity.relationships ?? []) as [],
    };

    const result = await engine.validateEntity(entity as import('@iris/connector-sdk').SemanticEntity, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Validation failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** GET /api/v1/validation/failures — list validation failures */
  app.get('/failures', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const query = listFailuresQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: query.error.message } }, 400);
    }

    const result = await engine.listFailures(workspaceId, {
      ...(query.data.cursor !== undefined ? { cursor: query.data.cursor } : {}),
      limit: query.data.limit,
      ...(query.data.acknowledged !== undefined ? { acknowledged: query.data.acknowledged } : {}),
      ...(query.data.ruleId !== undefined ? { ruleId: query.data.ruleId } : {}),
    });

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list failures' } }, 500);
    }

    const { failures, nextCursor, hasMore } = result.value;
    return c.json({
      data: failures,
      meta: { nextCursor, hasMore },
    });
  });

  /** POST /api/v1/validation/failures/:failureId/acknowledge — acknowledge a failure */
  app.post('/failures/:failureId/acknowledge', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { failureId } = c.req.param();
    const result = await engine.acknowledgeFailure(workspaceId, failureId);

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to acknowledge failure' } }, 500);
    }

    return c.json({ data: { acknowledged: true } });
  });

  /** GET /api/v1/validation/report — aggregate failure report */
  app.get('/report', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const entityType = c.req.query('entityType') ?? undefined;
    const result = await engine.generateReport(workspaceId, entityType);

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to generate report' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
