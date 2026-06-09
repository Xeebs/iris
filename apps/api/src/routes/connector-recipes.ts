import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { ConnectorRecipeManager } from '@iris/semantic-core/connector-recipes';

type SqlClient = ReturnType<typeof postgres>;

const connectorConfigSchema = z.object({
  connectorId: z.string().min(1),
  type: z.string().min(1),
  fieldMappings: z.record(z.string()).optional(),
  syncFrequency: z.enum(['hourly', 'daily', 'weekly']).optional(),
});

const glossaryTermSchema = z.object({
  term: z.string().min(1),
  definition: z.string().min(1),
  aliases: z.array(z.string()).optional(),
});

const workflowStepSchema = z.object({
  stepId: z.string().min(1),
  type: z.enum(['sync', 'enrich', 'alert', 'export']),
  config: z.record(z.unknown()),
});

const createRecipeSchema = z.object({
  recipeName: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  category: z.string().min(1),
  connectorsConfig: z.array(connectorConfigSchema).min(1),
  glossaryTerms: z.array(glossaryTermSchema).default([]),
  workflows: z.array(workflowStepSchema).default([]),
  shared: z.boolean().default(false),
});

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

/**
 * Routes for the connector recipe marketplace system.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createConnectorRecipeRoutes(sql: SqlClient) {
  const app = new Hono();
  const manager = new ConnectorRecipeManager(sql);

  /** GET /recipes/predefined — built-in recipe templates */
  app.get('/predefined', (c) => {
    const recipes = manager.getPredefinedRecipes();
    return c.json({ data: recipes });
  });

  /** GET /recipes/shared?category= — community shared recipes */
  app.get('/shared', async (c) => {
    const category = c.req.query('category') || undefined;
    const result = await manager.listSharedRecipes(category);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /recipes/templates — workspace recipes (alias for shared) */
  app.get('/templates', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await manager.listWorkspaceRecipes(workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /recipes/templates — create a new recipe in the workspace */
  app.post('/templates', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const parsed = createRecipeSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const authorUserId = (c.get('userId' as never) as string | undefined) ?? 'unknown';
    const result = await manager.createRecipe({
      workspaceId,
      authorUserId,
      ...parsed.data,
    } as Parameters<typeof manager.createRecipe>[0]);

    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** POST /recipes/:id/apply-to-workspace — install a recipe */
  app.post('/:id/apply-to-workspace', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const result = await manager.applyToWorkspace(c.req.param('id'), workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { applied: true } });
  });

  /** POST /recipes/:id/clone — clone a recipe into the workspace */
  app.post('/:id/clone', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const authorUserId = (c.get('userId' as never) as string | undefined) ?? 'unknown';
    const result = await manager.cloneRecipe(c.req.param('id'), workspaceId, authorUserId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** GET /recipes/:id — get a single recipe */
  app.get('/:id', async (c) => {
    const result = await manager.getRecipe(c.req.param('id'));
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Recipe not found' } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /recipes/:id — delete a workspace recipe */
  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const result = await manager.deleteRecipe(c.req.param('id'), workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: { deleted: true } });
  });

  /** GET /recipes/:id/reviews — list reviews */
  app.get('/:id/reviews', async (c) => {
    const result = await manager.getReviews(c.req.param('id'));
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /recipes/:id/reviews — add or update a review */
  app.post('/:id/reviews', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);

    const parsed = reviewSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const reviewerId = (c.get('userId' as never) as string | undefined) ?? 'unknown';
    const result = await manager.addReview({
      recipeId: c.req.param('id'),
      reviewerId,
      ...parsed.data,
    } as Parameters<typeof manager.addReview>[0]);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  return app;
}
