import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createConnectorRecipeRoutes } from '../routes/connector-recipes.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/connector-recipes', () => {
  const methods = {
    getPredefinedRecipes: vi.fn(),
    listSharedRecipes: vi.fn(),
    listWorkspaceRecipes: vi.fn(),
    createRecipe: vi.fn(),
    getRecipe: vi.fn(),
    cloneRecipe: vi.fn(),
    applyToWorkspace: vi.fn(),
    deleteRecipe: vi.fn(),
    getReviews: vi.fn(),
    addReview: vi.fn(),
  };
  return { ConnectorRecipeManager: vi.fn(() => methods) };
});

import { ConnectorRecipeManager } from '@iris/semantic-core/connector-recipes';
import { ok, err } from 'neverthrow';

function getManagerMock() {
  const CM = ConnectorRecipeManager as unknown as { mock: { results: Array<{ value: Record<string, ReturnType<typeof vi.fn>> }> } };
  return CM.mock.results[0]!.value;
}

function makeApp(withWorkspace = true) {
  const app = new Hono();
  if (withWorkspace) {
    app.use('*', async (c, next) => {
      c.set('workspaceId', 'ws-test');
      c.set('userId', 'user-test');
      await next();
    });
  }
  const sql = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;
  app.route('/', createConnectorRecipeRoutes(sql));
  return app;
}

function makeRecipe(overrides: Record<string, unknown> = {}) {
  return {
    id: 'recipe-1',
    workspaceId: 'ws-test',
    recipeName: 'Sales Ops',
    description: 'CRM setup',
    category: 'sales',
    connectorsConfig: [{ connectorId: 'hubspot', type: 'hubspot' }],
    glossaryTerms: [],
    workflows: [],
    authorUserId: 'user-test',
    shared: false,
    usageCount: 0,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('connector-recipes routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('GET /predefined', () => {
    it('returns predefined recipes without auth', async () => {
      const app = makeApp(false);
      getManagerMock().getPredefinedRecipes.mockReturnValue([{ recipeName: 'Sales Ops', category: 'sales' }]);
      const res = await app.request('/predefined');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });
  });

  describe('GET /shared', () => {
    it('returns shared recipes with ratings', async () => {
      const app = makeApp();
      getManagerMock().listSharedRecipes.mockResolvedValueOnce(ok([makeRecipe({ shared: true, avgRating: 4.5, reviewCount: 3 })]));
      const res = await app.request('/shared');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 500 when manager fails', async () => {
      const app = makeApp();
      getManagerMock().listSharedRecipes.mockResolvedValueOnce(err(new Error('DB fail')));
      const res = await app.request('/shared');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /templates', () => {
    it('returns workspace recipes', async () => {
      const app = makeApp();
      getManagerMock().listWorkspaceRecipes.mockResolvedValueOnce(ok([makeRecipe()]));
      const res = await app.request('/templates');
      expect(res.status).toBe(200);
    });

    it('returns 401 when workspaceId missing', async () => {
      const app = makeApp(false);
      const res = await app.request('/templates');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /templates', () => {
    it('creates a recipe and returns 201', async () => {
      const app = makeApp();
      getManagerMock().createRecipe.mockResolvedValueOnce(ok(makeRecipe()));
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipeName: 'Sales Ops',
          description: 'CRM setup',
          category: 'sales',
          connectorsConfig: [{ connectorId: 'hubspot', type: 'hubspot' }],
        }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid payload', async () => {
      const app = makeApp();
      const res = await app.request('/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeName: '' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /:id/apply-to-workspace', () => {
    it('applies recipe and returns applied:true', async () => {
      const app = makeApp();
      getManagerMock().applyToWorkspace.mockResolvedValueOnce(ok(undefined));
      const res = await app.request('/recipe-1/apply-to-workspace', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { applied: boolean } };
      expect(body.data.applied).toBe(true);
    });

    it('returns 401 without workspace', async () => {
      const app = makeApp(false);
      const res = await app.request('/recipe-1/apply-to-workspace', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /:id/clone', () => {
    it('clones recipe and returns 201', async () => {
      const app = makeApp();
      getManagerMock().cloneRecipe.mockResolvedValueOnce(ok(makeRecipe({ id: 'clone-1' })));
      const res = await app.request('/recipe-1/clone', { method: 'POST' });
      expect(res.status).toBe(201);
    });

    it('returns 401 without workspace', async () => {
      const app = makeApp(false);
      const res = await app.request('/recipe-1/clone', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /:id', () => {
    it('returns recipe by id', async () => {
      const app = makeApp();
      getManagerMock().getRecipe.mockResolvedValueOnce(ok(makeRecipe()));
      const res = await app.request('/recipe-1');
      expect(res.status).toBe(200);
    });

    it('returns 404 when not found', async () => {
      const app = makeApp();
      getManagerMock().getRecipe.mockResolvedValueOnce(ok(null));
      const res = await app.request('/missing-recipe');
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes recipe and returns deleted:true', async () => {
      const app = makeApp();
      getManagerMock().deleteRecipe.mockResolvedValueOnce(ok(undefined));
      const res = await app.request('/recipe-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);
    });

    it('returns 401 without workspace', async () => {
      const app = makeApp(false);
      const res = await app.request('/recipe-1', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /:id/reviews', () => {
    it('returns reviews', async () => {
      const app = makeApp();
      const review = { id: 'rv-1', recipeId: 'recipe-1', reviewerId: 'u', rating: 5, createdAt: new Date() };
      getManagerMock().getReviews.mockResolvedValueOnce(ok([review]));
      const res = await app.request('/recipe-1/reviews');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /:id/reviews', () => {
    it('adds review and returns 201', async () => {
      const app = makeApp();
      const review = { id: 'rv-1', recipeId: 'recipe-1', reviewerId: 'user-test', rating: 4, comment: 'Good', createdAt: new Date() };
      getManagerMock().addReview.mockResolvedValueOnce(ok(review));
      const res = await app.request('/recipe-1/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 4, comment: 'Good' }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid rating', async () => {
      const app = makeApp();
      const res = await app.request('/recipe-1/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 10 }),
      });
      expect(res.status).toBe(400);
    });
  });
});
