import { ok, err, type Result } from 'neverthrow';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ module: 'connector-recipes' });

type SqlClient = ReturnType<typeof postgres>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectorConfig {
  connectorId: string;
  type: string;
  fieldMappings?: Record<string, string>;
  syncFrequency?: 'hourly' | 'daily' | 'weekly';
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  aliases?: string[];
}

export interface WorkflowStep {
  stepId: string;
  type: 'sync' | 'enrich' | 'alert' | 'export';
  config: Record<string, unknown>;
}

export interface ConnectorRecipe {
  id: string;
  workspaceId: string;
  recipeName: string;
  description: string;
  category: string;
  connectorsConfig: ConnectorConfig[];
  glossaryTerms: GlossaryTerm[];
  workflows: WorkflowStep[];
  authorUserId: string;
  shared: boolean;
  usageCount: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeReview {
  id: string;
  recipeId: string;
  reviewerId: string;
  rating: number;
  comment?: string;
  createdAt: Date;
}

export interface RecipeWithRating extends ConnectorRecipe {
  avgRating: number | null;
  reviewCount: number;
}

export type RecipeCategory = 'sales' | 'finance' | 'ops' | 'hr' | 'marketing' | 'general';

// ─── Predefined recipes ────────────────────────────────────────────────────────

export const PREDEFINED_RECIPES: Array<
  Omit<ConnectorRecipe, 'id' | 'workspaceId' | 'authorUserId' | 'createdAt' | 'updatedAt' | 'usageCount' | 'version'>
> = [
  {
    recipeName: 'Sales Operations Setup',
    description:
      'Complete sales ops stack: HubSpot CRM + Salesforce + Stripe billing with deal pipeline tracking',
    category: 'sales',
    connectorsConfig: [
      {
        connectorId: 'hubspot',
        type: 'hubspot',
        fieldMappings: { contact_name: 'label', lifecycle_stage: 'stage' },
        syncFrequency: 'hourly',
      },
      {
        connectorId: 'salesforce',
        type: 'salesforce',
        fieldMappings: { opportunity_name: 'label', close_date: 'dueDate' },
        syncFrequency: 'hourly',
      },
      {
        connectorId: 'stripe',
        type: 'stripe',
        fieldMappings: { customer_name: 'label', mrr: 'revenue' },
        syncFrequency: 'daily',
      },
    ],
    glossaryTerms: [
      { term: 'MQL', definition: 'Marketing Qualified Lead — contact meeting lead score criteria', aliases: ['marketing qualified lead'] },
      { term: 'SQL', definition: 'Sales Qualified Lead — lead accepted by the sales team', aliases: ['sales qualified lead'] },
      { term: 'ARR', definition: 'Annual Recurring Revenue', aliases: ['annual recurring revenue'] },
    ],
    workflows: [
      { stepId: 'sync-crm', type: 'sync', config: { priority: 'high', entities: ['contact', 'deal', 'company'] } },
      { stepId: 'alert-churn-risk', type: 'alert', config: { condition: 'churn_score > 0.7', channel: 'slack' } },
    ],
    shared: true,
  },
  {
    recipeName: 'Finance & Compliance',
    description: 'QuickBooks + Stripe + Google Drive for financial reporting and compliance document tracking',
    category: 'finance',
    connectorsConfig: [
      {
        connectorId: 'quickbooks',
        type: 'quickbooks',
        fieldMappings: { vendor_name: 'label', invoice_total: 'amount' },
        syncFrequency: 'daily',
      },
      {
        connectorId: 'stripe',
        type: 'stripe',
        fieldMappings: { charge_description: 'label' },
        syncFrequency: 'daily',
      },
      {
        connectorId: 'google-drive',
        type: 'google-drive',
        fieldMappings: { file_name: 'label' },
        syncFrequency: 'weekly',
      },
    ],
    glossaryTerms: [
      { term: 'COGS', definition: 'Cost of Goods Sold', aliases: ['cost of goods sold'] },
      { term: 'Burn rate', definition: 'Monthly net cash outflow', aliases: ['cash burn'] },
    ],
    workflows: [
      { stepId: 'monthly-close', type: 'sync', config: { schedule: 'last-day-of-month', entities: ['invoice', 'payment'] } },
      { stepId: 'export-ledger', type: 'export', config: { format: 'csv', destination: 'google-drive' } },
    ],
    shared: true,
  },
  {
    recipeName: 'Customer Support Hub',
    description: 'Zendesk + Notion for unified support knowledge and ticket tracking',
    category: 'ops',
    connectorsConfig: [
      {
        connectorId: 'zendesk',
        type: 'zendesk',
        fieldMappings: { ticket_subject: 'label', status: 'stage' },
        syncFrequency: 'hourly',
      },
      {
        connectorId: 'notion',
        type: 'notion',
        fieldMappings: { page_title: 'label' },
        syncFrequency: 'daily',
      },
    ],
    glossaryTerms: [
      { term: 'CSAT', definition: 'Customer Satisfaction Score — 1-5 rating after ticket resolution', aliases: ['customer satisfaction'] },
      { term: 'FRT', definition: 'First Response Time — time until first agent reply', aliases: ['first response time'] },
    ],
    workflows: [
      { stepId: 'enrich-tickets', type: 'enrich', config: { sources: ['notion'], entityType: 'ticket' } },
    ],
    shared: true,
  },
];

// ─── Row mapping ───────────────────────────────────────────────────────────────

interface RecipeRow {
  id: string;
  workspace_id: string;
  recipe_name: string;
  description: string;
  category: string;
  connectors_config_json: ConnectorConfig[];
  glossary_terms_json: GlossaryTerm[];
  workflows_json: WorkflowStep[];
  author_user_id: string;
  shared: boolean;
  usage_count: string;
  version: string;
  created_at: string;
  updated_at: string;
  avg_rating?: string | null;
  review_count?: string;
}

function rowToRecipe(row: RecipeRow): ConnectorRecipe {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    recipeName: row.recipe_name,
    description: row.description,
    category: row.category,
    connectorsConfig: row.connectors_config_json,
    glossaryTerms: row.glossary_terms_json,
    workflows: row.workflows_json,
    authorUserId: row.author_user_id,
    shared: row.shared,
    usageCount: parseInt(row.usage_count, 10),
    version: parseInt(row.version, 10),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ─── Manager ──────────────────────────────────────────────────────────────────

/**
 * Manages connector configuration recipes and the shared marketplace.
 */
export class ConnectorRecipeManager {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Creates a new recipe in a workspace.
   *
   * @param input - Recipe fields
   * @returns The created recipe or an error
   */
  async createRecipe(input: {
    workspaceId: string;
    recipeName: string;
    description: string;
    category: string;
    connectorsConfig: ConnectorConfig[];
    glossaryTerms: GlossaryTerm[];
    workflows: WorkflowStep[];
    authorUserId: string;
    shared?: boolean;
  }): Promise<Result<ConnectorRecipe, Error>> {
    try {
      const rows = await this.sql<RecipeRow[]>`
        INSERT INTO connector_recipes
          (workspace_id, recipe_name, description, category,
           connectors_config_json, glossary_terms_json, workflows_json,
           author_user_id, shared)
        VALUES
          (${input.workspaceId}, ${input.recipeName}, ${input.description}, ${input.category},
           ${JSON.stringify(input.connectorsConfig)}, ${JSON.stringify(input.glossaryTerms)}, ${JSON.stringify(input.workflows)},
           ${input.authorUserId}, ${input.shared ?? false})
        RETURNING *
      `;
      const row = rows[0];
      if (!row) return err(new Error('Insert returned no rows'));
      log.info('Recipe created', { recipeId: row.id, workspaceId: input.workspaceId });
      return ok(rowToRecipe(row));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Retrieves a single recipe by ID.
   *
   * @param recipeId - UUID of the recipe
   * @returns The recipe, null if not found, or an error
   */
  async getRecipe(recipeId: string): Promise<Result<ConnectorRecipe | null, Error>> {
    try {
      const rows = await this.sql<RecipeRow[]>`
        SELECT * FROM connector_recipes WHERE id = ${recipeId}
      `;
      return ok(rows[0] ? rowToRecipe(rows[0]) : null);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists all recipes owned by a workspace.
   *
   * @param workspaceId - Target workspace
   * @returns Array of recipes or an error
   */
  async listWorkspaceRecipes(workspaceId: string): Promise<Result<ConnectorRecipe[], Error>> {
    try {
      const rows = await this.sql<RecipeRow[]>`
        SELECT * FROM connector_recipes
        WHERE workspace_id = ${workspaceId}
        ORDER BY updated_at DESC
      `;
      return ok(rows.map(rowToRecipe));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Lists publicly shared recipes, optionally filtered by category, including
   * aggregated review data.
   *
   * @param category - Optional category filter
   * @returns Recipes with rating info or an error
   */
  async listSharedRecipes(category?: string): Promise<Result<RecipeWithRating[], Error>> {
    try {
      const rows = await this.sql<(RecipeRow & { avg_rating: string | null; review_count: string })[]>`
        SELECT r.*,
               AVG(rv.rating)::TEXT   AS avg_rating,
               COUNT(rv.id)::TEXT     AS review_count
        FROM connector_recipes r
        LEFT JOIN recipe_reviews rv ON rv.recipe_id = r.id
        WHERE r.shared = true
          ${category ? this.sql`AND r.category = ${category}` : this.sql``}
        GROUP BY r.id
        ORDER BY r.usage_count DESC, r.created_at DESC
      `;
      return ok(
        rows.map((row) => ({
          ...rowToRecipe(row),
          avgRating: row.avg_rating != null ? parseFloat(row.avg_rating) : null,
          reviewCount: parseInt(row.review_count ?? '0', 10),
        })),
      );
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Clones an existing recipe into a new workspace.
   *
   * @param recipeId - Source recipe ID
   * @param targetWorkspaceId - Destination workspace
   * @param authorUserId - User performing the clone
   * @returns The cloned recipe or an error
   */
  async cloneRecipe(
    recipeId: string,
    targetWorkspaceId: string,
    authorUserId: string,
  ): Promise<Result<ConnectorRecipe, Error>> {
    try {
      const sourceResult = await this.getRecipe(recipeId);
      if (sourceResult.isErr()) return err(sourceResult.error);
      const source = sourceResult.value;
      if (!source) return err(new Error(`Recipe ${recipeId} not found`));

      const cloneResult = await this.createRecipe({
        workspaceId: targetWorkspaceId,
        recipeName: `${source.recipeName} (copy)`,
        description: source.description,
        category: source.category,
        connectorsConfig: source.connectorsConfig,
        glossaryTerms: source.glossaryTerms,
        workflows: source.workflows,
        authorUserId,
        shared: false,
      });

      if (cloneResult.isOk()) {
        // Increment usage count on the source
        await this.sql`
          UPDATE connector_recipes
          SET usage_count = usage_count + 1
          WHERE id = ${recipeId}
        `;
        log.info('Recipe cloned', { sourceId: recipeId, targetWorkspaceId, cloneId: cloneResult.value.id });
      }
      return cloneResult;
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Records that a recipe was applied to a workspace (increments usage counter).
   *
   * @param recipeId - Recipe being applied
   * @param workspaceId - Workspace applying the recipe
   * @returns void or an error
   */
  async applyToWorkspace(recipeId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        UPDATE connector_recipes
        SET usage_count = usage_count + 1
        WHERE id = ${recipeId}
      `;
      log.info('Recipe applied to workspace', { recipeId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Adds or updates a review for a shared recipe.
   *
   * @param review - Review payload
   * @returns The persisted review or an error
   */
  async addReview(review: {
    recipeId: string;
    reviewerId: string;
    rating: number;
    comment?: string;
  }): Promise<Result<RecipeReview, Error>> {
    if (review.rating < 1 || review.rating > 5) {
      return err(new Error('Rating must be between 1 and 5'));
    }
    try {
      const rows = await this.sql<Array<{ id: string; recipe_id: string; reviewer_id: string; rating: number; comment: string | null; created_at: string }>>`
        INSERT INTO recipe_reviews (recipe_id, reviewer_id, rating, comment)
        VALUES (${review.recipeId}, ${review.reviewerId}, ${review.rating}, ${review.comment ?? null})
        ON CONFLICT (recipe_id, reviewer_id)
        DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment
        RETURNING *
      `;
      const row = rows[0];
      if (!row) return err(new Error('Review upsert returned no rows'));
      return ok({
        id: row.id,
        recipeId: row.recipe_id,
        reviewerId: row.reviewer_id,
        rating: row.rating,
        ...(row.comment != null ? { comment: row.comment } : {}),
        createdAt: new Date(row.created_at),
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns all reviews for a recipe.
   *
   * @param recipeId - Recipe to fetch reviews for
   * @returns Array of reviews or an error
   */
  async getReviews(recipeId: string): Promise<Result<RecipeReview[], Error>> {
    try {
      const rows = await this.sql<Array<{ id: string; recipe_id: string; reviewer_id: string; rating: number; comment: string | null; created_at: string }>>`
        SELECT * FROM recipe_reviews WHERE recipe_id = ${recipeId} ORDER BY created_at DESC
      `;
      return ok(
        rows.map((r) => ({
          id: r.id,
          recipeId: r.recipe_id,
          reviewerId: r.reviewer_id,
          rating: r.rating,
          ...(r.comment != null ? { comment: r.comment } : {}),
          createdAt: new Date(r.created_at),
        })),
      );
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Deletes a recipe (only workspace owner can delete).
   *
   * @param recipeId - Recipe to delete
   * @param workspaceId - Owning workspace (for ownership check)
   * @returns void or an error
   */
  async deleteRecipe(recipeId: string, workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        DELETE FROM connector_recipes
        WHERE id = ${recipeId} AND workspace_id = ${workspaceId}
      `;
      log.info('Recipe deleted', { recipeId, workspaceId });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Returns the built-in predefined recipe templates.
   *
   * @returns Array of predefined recipe templates
   */
  getPredefinedRecipes(): typeof PREDEFINED_RECIPES {
    return PREDEFINED_RECIPES;
  }
}
