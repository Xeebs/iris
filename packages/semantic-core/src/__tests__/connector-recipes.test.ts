import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConnectorRecipeManager,
  PREDEFINED_RECIPES,
  type ConnectorRecipe,
  type ConnectorConfig,
} from '../connector-recipes.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

function makeSql(...responses: unknown[][]) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  (fn as unknown as Record<string, unknown>).array = vi.fn((v: unknown) => v);
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeRecipeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'recipe-1',
    workspace_id: 'ws-1',
    recipe_name: 'Sales Ops',
    description: 'CRM + billing setup',
    category: 'sales',
    connectors_config_json: [{ connectorId: 'hubspot', type: 'hubspot' }],
    glossary_terms_json: [{ term: 'MQL', definition: 'Marketing Qualified Lead' }],
    workflows_json: [{ stepId: 'sync', type: 'sync', config: {} }],
    author_user_id: 'user-1',
    shared: false,
    usage_count: '5',
    version: '1',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('PREDEFINED_RECIPES', () => {
  it('includes at least 3 recipes', () => {
    expect(PREDEFINED_RECIPES.length).toBeGreaterThanOrEqual(3);
  });

  it('each recipe has required fields', () => {
    for (const r of PREDEFINED_RECIPES) {
      expect(r.recipeName).toBeTruthy();
      expect(r.description).toBeTruthy();
      expect(r.category).toBeTruthy();
      expect(Array.isArray(r.connectorsConfig)).toBe(true);
      expect(r.connectorsConfig.length).toBeGreaterThan(0);
    }
  });

  it('all shared recipes have glossary terms', () => {
    const shared = PREDEFINED_RECIPES.filter((r) => r.shared);
    for (const r of shared) {
      expect(r.glossaryTerms.length).toBeGreaterThan(0);
    }
  });

  it('sales recipe includes HubSpot and Stripe', () => {
    const sales = PREDEFINED_RECIPES.find((r) => r.category === 'sales');
    expect(sales).toBeDefined();
    const types = sales!.connectorsConfig.map((c) => c.type);
    expect(types).toContain('hubspot');
    expect(types).toContain('stripe');
  });

  it('finance recipe includes QuickBooks', () => {
    const finance = PREDEFINED_RECIPES.find((r) => r.category === 'finance');
    expect(finance).toBeDefined();
    const types = finance!.connectorsConfig.map((c) => c.type);
    expect(types).toContain('quickbooks');
  });
});

describe('ConnectorRecipeManager', () => {
  describe('getPredefinedRecipes', () => {
    it('returns PREDEFINED_RECIPES', () => {
      const sql = makeSql();
      const manager = new ConnectorRecipeManager(sql);
      expect(manager.getPredefinedRecipes()).toBe(PREDEFINED_RECIPES);
    });
  });

  describe('createRecipe', () => {
    it('inserts and returns recipe on success', async () => {
      const row = makeRecipeRow({ shared: false });
      const sql = makeSql([row]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.createRecipe({
        workspaceId: 'ws-1',
        recipeName: 'Sales Ops',
        description: 'CRM + billing setup',
        category: 'sales',
        connectorsConfig: [{ connectorId: 'hubspot', type: 'hubspot' }],
        glossaryTerms: [],
        workflows: [],
        authorUserId: 'user-1',
      });
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe('recipe-1');
        expect(result.value.recipeName).toBe('Sales Ops');
        expect(result.value.usageCount).toBe(5);
      }
    });

    it('returns err when sql throws', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('DB fail'));
      (fn as unknown as Record<string, unknown>).array = vi.fn();
      const sql = fn as unknown as ReturnType<typeof import('postgres').default>;
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.createRecipe({
        workspaceId: 'ws-1', recipeName: 'x', description: 'y', category: 'general',
        connectorsConfig: [], glossaryTerms: [], workflows: [], authorUserId: 'u',
      });
      expect(result.isErr()).toBe(true);
    });

    it('returns err when insert returns no rows', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.createRecipe({
        workspaceId: 'ws-1', recipeName: 'x', description: 'y', category: 'general',
        connectorsConfig: [], glossaryTerms: [], workflows: [], authorUserId: 'u',
      });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getRecipe', () => {
    it('returns recipe when found', async () => {
      const sql = makeSql([makeRecipeRow()]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.getRecipe('recipe-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()?.id).toBe('recipe-1');
    });

    it('returns null when not found', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.getRecipe('missing');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });
  });

  describe('listWorkspaceRecipes', () => {
    it('returns all workspace recipes', async () => {
      const sql = makeSql([makeRecipeRow(), makeRecipeRow({ id: 'recipe-2', recipe_name: 'Finance Setup' })]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.listWorkspaceRecipes('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('returns empty array for workspace with no recipes', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.listWorkspaceRecipes('ws-empty');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('listSharedRecipes', () => {
    it('returns shared recipes with rating info', async () => {
      const row = { ...makeRecipeRow({ shared: true }), avg_rating: '4.5', review_count: '10' };
      // Two calls: first is the nested this.sql`` fragment for the category filter, second is the main SELECT
      const sql = makeSql([], [row]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.listSharedRecipes();
      expect(result.isOk()).toBe(true);
      const recipes = result._unsafeUnwrap();
      expect(recipes[0]?.avgRating).toBeCloseTo(4.5);
      expect(recipes[0]?.reviewCount).toBe(10);
    });

    it('returns null avgRating when no reviews', async () => {
      const row = { ...makeRecipeRow({ shared: true }), avg_rating: null, review_count: '0' };
      const sql = makeSql([], [row]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.listSharedRecipes();
      const recipes = result._unsafeUnwrap();
      expect(recipes[0]?.avgRating).toBeNull();
      expect(recipes[0]?.reviewCount).toBe(0);
    });
  });

  describe('cloneRecipe', () => {
    it('creates a copy and increments usage on source', async () => {
      const sourceRow = makeRecipeRow({ shared: true });
      const cloneRow = makeRecipeRow({ id: 'clone-1', recipe_name: 'Sales Ops (copy)', workspace_id: 'ws-2' });
      const sql = makeSql([sourceRow], [cloneRow], []);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.cloneRecipe('recipe-1', 'ws-2', 'user-2');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().id).toBe('clone-1');
    });

    it('returns err when source recipe not found', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.cloneRecipe('missing', 'ws-2', 'user-2');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('applyToWorkspace', () => {
    it('increments usage count and returns ok', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.applyToWorkspace('recipe-1', 'ws-2');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledTimes(1);
    });
  });

  describe('addReview', () => {
    it('upserts and returns review', async () => {
      const reviewRow = { id: 'rv-1', recipe_id: 'recipe-1', reviewer_id: 'user-2', rating: 4, comment: 'Great!', created_at: '2026-06-01T00:00:00.000Z' };
      const sql = makeSql([reviewRow]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.addReview({ recipeId: 'recipe-1', reviewerId: 'user-2', rating: 4, comment: 'Great!' });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().rating).toBe(4);
    });

    it('returns err for rating outside 1-5', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.addReview({ recipeId: 'r', reviewerId: 'u', rating: 6 });
      expect(result.isErr()).toBe(true);
    });

    it('handles missing comment', async () => {
      const reviewRow = { id: 'rv-2', recipe_id: 'r-1', reviewer_id: 'u-1', rating: 5, comment: null, created_at: '2026-06-01T00:00:00.000Z' };
      const sql = makeSql([reviewRow]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.addReview({ recipeId: 'r-1', reviewerId: 'u-1', rating: 5 });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().comment).toBeUndefined();
    });
  });

  describe('getReviews', () => {
    it('returns all reviews for a recipe', async () => {
      const rows = [
        { id: 'rv-1', recipe_id: 'r-1', reviewer_id: 'u-1', rating: 5, comment: 'Excellent', created_at: '2026-06-01T00:00:00.000Z' },
        { id: 'rv-2', recipe_id: 'r-1', reviewer_id: 'u-2', rating: 3, comment: null, created_at: '2026-06-02T00:00:00.000Z' },
      ];
      const sql = makeSql(rows);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.getReviews('r-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });
  });

  describe('deleteRecipe', () => {
    it('deletes recipe and returns ok', async () => {
      const sql = makeSql([]);
      const manager = new ConnectorRecipeManager(sql);
      const result = await manager.deleteRecipe('recipe-1', 'ws-1');
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledTimes(1);
    });
  });
});
