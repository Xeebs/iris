import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { ConnectorMarketplaceService } from '@iris/semantic-core/connector-marketplace';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'marketplace' });
type SqlClient = ReturnType<typeof postgres>;

const listingsQuerySchema = z.object({
  category: z.string().optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sortBy: z.enum(['popularity', 'rating', 'installs', 'newest']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional(),
});

const rateBodySchema = z.object({
  reviewerId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

const submitBodySchema = z.object({
  connectorId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  category: z.string().optional(),
  iconUrl: z.string().url().optional(),
  documentationUrl: z.string().url().optional(),
  author: z.string().optional(),
  version: z.string().optional(),
});

const curateBodySchema = z.object({
  publish: z.boolean(),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/marketplace
 */
export function createMarketplaceRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const svc = new ConnectorMarketplaceService(sql as ConstructorParameters<typeof ConnectorMarketplaceService>[0]);

  /** GET /api/v1/marketplace/connectors — paginated connector listings */
  app.get('/connectors', async (c) => {
    const parsed = listingsQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid query params', details: parsed.error.errors } }, 400);
    }

    const { category, minRating, sortBy, cursor, limit } = parsed.data;
    const filters = {
      ...(category !== undefined && { category }),
      ...(minRating !== undefined && { minRating }),
      ...(sortBy !== undefined && { sortBy }),
      ...(cursor !== undefined && { cursor }),
      ...(limit !== undefined && { limit }),
    };
    const result = await svc.getListings(filters);
    if (result.isErr()) {
      log.error('Failed to get listings', { error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve connector listings' } }, 500);
    }

    const { listings, nextCursor, hasMore } = result.value;
    return c.json({ data: listings, meta: { nextCursor, hasMore } });
  });

  /** GET /api/v1/marketplace/connectors/:id/ratings — reviews for a connector */
  app.get('/connectors/:id/ratings', async (c) => {
    const connectorId = c.req.param('id');

    const result = await svc.getRatings(connectorId);
    if (result.isErr()) {
      log.error('Failed to get ratings', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve ratings' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /api/v1/marketplace/connectors/:id/install — install connector for workspace */
  app.post('/connectors/:id/install', async (c) => {
    const connectorId = c.req.param('id');
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const result = await svc.installConnector(workspaceId, connectorId);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      log.error('Failed to install connector', { workspaceId, connectorId, error: msg });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to install connector' } }, 500);
    }

    log.info('Connector installed', { workspaceId, connectorId });
    return c.json({ data: { installed: true, connectorId } }, 200);
  });

  /** POST /api/v1/marketplace/connectors/:id/rate — submit or update a review */
  app.post('/connectors/:id/rate', async (c) => {
    const connectorId = c.req.param('id');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const parsed = rateBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.errors } }, 400);
    }

    const { reviewerId, rating, comment } = parsed.data;
    const result = await svc.rateConnector(connectorId, reviewerId, rating, comment);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('between 1 and 5')) {
        return c.json({ error: { code: 'VALIDATION_ERROR', message: msg } }, 400);
      }
      if (msg.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      log.error('Failed to rate connector', { connectorId, error: msg });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to submit rating' } }, 500);
    }

    return c.json({ data: result.value }, 201);
  });

  /** POST /api/v1/marketplace/connectors — submit a new connector for curation */
  app.post('/connectors', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const parsed = submitBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.errors } }, 400);
    }

    const { connectorId, name, description, category: cat, iconUrl, documentationUrl, author, version } = parsed.data;
    const opts = {
      connectorId,
      name,
      description,
      ...(cat !== undefined && { category: cat }),
      ...(iconUrl !== undefined && { iconUrl }),
      ...(documentationUrl !== undefined && { documentationUrl }),
      ...(author !== undefined && { author }),
      ...(version !== undefined && { version }),
    };
    const result = await svc.submitConnector(opts);
    if (result.isErr()) {
      log.error('Failed to submit connector', { error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to submit connector' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** PUT /api/v1/marketplace/connectors/:id/curate — approve or reject a connector (admin) */
  app.put('/connectors/:id/curate', async (c) => {
    const connectorId = c.req.param('id');
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }, 400);
    }

    const parsed = curateBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'publish field required (boolean)' } }, 400);
    }

    const result = await svc.curateListing(connectorId, parsed.data.publish);
    if (result.isErr()) {
      log.error('Failed to curate listing', { connectorId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to curate listing' } }, 500);
    }
    return c.json({ data: { curated: true, connectorId, published: parsed.data.publish } });
  });

  return app;
}
