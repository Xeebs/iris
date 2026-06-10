import { Hono } from 'hono';
import { z } from 'zod';

import { SchemaDiscoveryEngine } from '@iris/semantic-core/schema-discovery';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'schema-discovery' });

type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>) & {
  /** postgres.js typed json parameter — see SchemaDiscoveryEngine */
  json(value: unknown): unknown;
};

const confirmBodySchema = z.object({
  type: z.enum(['entity_type', 'relationship']),
});

/**
 * Factory for schema discovery routes.
 *
 * @param sql - Postgres client
 * @returns Hono router for schema discovery endpoints
 */
export function createSchemaDiscoveryRoutes(sql: SqlFn): Hono {
  const app = new Hono();
  const engine = new SchemaDiscoveryEngine(sql);

  /** POST /api/v1/connectors/:connectorId/discover-schema — trigger discovery */
  app.post('/:connectorId/discover-schema', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { connectorId } = c.req.param();
    log.info('Schema discovery triggered', { connectorId });

    const result = await engine.runDiscovery(connectorId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Discovery failed' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** GET /api/v1/connectors/:connectorId/schema-suggestions — list suggestions */
  app.get('/:connectorId/schema-suggestions', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { connectorId } = c.req.param();
    const result = await engine.listSuggestions(connectorId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list suggestions' } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/schema-suggestions/:suggestionId/confirm — confirm a suggestion */
  app.post('/suggestions/:suggestionId/confirm', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { suggestionId } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const parsed = confirmBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const table = parsed.data.type === 'entity_type'
      ? 'entity_type_suggestions' as const
      : 'relationship_suggestions' as const;

    const result = await engine.confirmSuggestion(suggestionId, table);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Confirm failed' } }, 500);
    }

    return c.json({ data: { confirmed: true } });
  });

  /** GET /api/v1/connectors/:connectorId/schema-report — full mapping report */
  app.get('/:connectorId/schema-report', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { connectorId } = c.req.param();
    const result = await engine.generateMappingReport(connectorId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Report generation failed' } }, 500);
    }

    return c.json({ data: result.value });
  });

  return app;
}
