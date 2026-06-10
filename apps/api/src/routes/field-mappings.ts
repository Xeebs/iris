import { Hono } from 'hono';
import { z } from 'zod';
import {
  suggestEntityMapping,
  learnFieldMappings,
  getLearnedMappings,
  validateMappingLogic,
  generateMappingCode,
} from '@iris/semantic-core/smart-field-mapper';
import type { SourceField } from '@iris/semantic-core/smart-field-mapper';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'field-mappings' });

type Sql = Parameters<typeof learnFieldMappings>[0];

const SourceFieldSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'date', 'array', 'object']),
  description: z.string().optional(),
});

const SuggestMappingSchema = z.object({
  sourceFields: z.array(SourceFieldSchema).min(1),
  targetEntityType: z.string().min(1),
});

const ConfirmMappingSchema = z.object({
  mappings: z.array(z.object({
    sourceField: z.string().min(1),
    targetField: z.string().min(1),
    entityType: z.string().min(1),
  })).min(1),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for connector field mapping endpoints
 */
export function createFieldMappingsRoutes(sql: Sql): Hono {
  const app = new Hono();

  /** POST /connectors/:connectorId/suggest-mapping — run mapping suggestion */
  app.post('/:connectorId/suggest-mapping', async (c) => {
    const connectorId = c.req.param('connectorId');

    const body = await c.req.json().catch(() => ({}));
    const parsed = SuggestMappingSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.format() } }, 400);
    }

    const learnedResult = await getLearnedMappings(sql, connectorId);
    const learned = learnedResult.isOk() ? learnedResult.value : [];

    const suggestions = suggestEntityMapping(
      parsed.data.sourceFields as SourceField[],
      parsed.data.targetEntityType,
      learned,
    );

    const enriched = suggestions.map(s => ({
      ...s,
      validation: validateMappingLogic(s, suggestions),
      generatedCode: generateMappingCode(s),
    }));

    log.info('Mapping suggestions generated', { connectorId, count: suggestions.length, entityType: parsed.data.targetEntityType });

    return c.json({ data: enriched, meta: { count: enriched.length } });
  });

  /** GET /connectors/:connectorId/mapping-suggestions — list suggestions using stored schema */
  app.get('/:connectorId/mapping-suggestions', async (c) => {
    const connectorId = c.req.param('connectorId');

    const result = await getLearnedMappings(sql, connectorId);

    if (result.isErr()) {
      return c.json({ error: { code: 'DB_ERROR', message: 'Failed to load mappings' } }, 500);
    }

    return c.json({ data: result.value, meta: { count: result.value.length } });
  });

  /** POST /connectors/:connectorId/mapping-suggestions/confirm — accept and persist mappings */
  app.post('/:connectorId/mapping-suggestions/confirm', async (c) => {
    const connectorId = c.req.param('connectorId');

    const body = await c.req.json().catch(() => ({}));
    const parsed = ConfirmMappingSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid mappings payload', details: parsed.error.format() } }, 400);
    }

    const result = await learnFieldMappings(sql, connectorId, parsed.data.mappings);

    if (result.isErr()) {
      return c.json({ error: { code: 'DB_ERROR', message: 'Failed to save mappings' } }, 500);
    }

    return c.json({ data: { confirmed: parsed.data.mappings.length, connectorId } }, 201);
  });

  return app;
}

// Backward-compat default export for tests (tests mock all underlying functions)
export default createFieldMappingsRoutes(undefined as unknown as Sql);
