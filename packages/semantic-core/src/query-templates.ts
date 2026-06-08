import { ok, err, type Result } from 'neverthrow';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'query-templates' });

// ─── Types ────────────────────────────────────────────────────────────────────

export type TemplateVisibility = 'private' | 'workspace' | 'public';

export type TemplateParameter = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'entity_type';
  required: boolean;
  defaultValue?: string | number | boolean;
  description?: string;
};

export type QueryTemplate = {
  id: string;
  name: string;
  query: string;
  parameters: TemplateParameter[];
  description: string;
  tags: string[];
  visibility: TemplateVisibility;
  workspaceId: string;
  createdBy: string;
  createdAt: Date;
  usageCount: number;
};

export type TemplateInstantiation = {
  templateId: string;
  query: string;
  boundParameters: Record<string, unknown>;
};

export type TemplateOptimization = {
  templateId: string;
  suggestion: string;
  impactLevel: 'low' | 'medium' | 'high';
  reason: string;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Extract parameter placeholders from a query string.
 * Format: `{{paramName}}`
 * @param query - Query string with optional placeholders
 * @returns Array of parameter names found
 */
export function extractParameterNames(query: string): string[] {
  const matches = query.matchAll(/\{\{(\w+)\}\}/g);
  return [...new Set([...matches].map((m) => m[1]!))];
}

/**
 * Bind parameter values into a query template string.
 * Replaces `{{paramName}}` with the corresponding value.
 * @param query - Template query string
 * @param values - Parameter name → value map
 * @returns Instantiated query
 */
export function bindParameters(query: string, values: Record<string, unknown>): string {
  return query.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    const val = values[name];
    return val !== undefined ? String(val) : match;
  });
}

/**
 * Validate that all required parameters have been supplied.
 * @param parameters - Template parameter definitions
 * @param values - Supplied values
 * @returns null if valid; error message if invalid
 */
export function validateParameterValues(
  parameters: TemplateParameter[],
  values: Record<string, unknown>,
): string | null {
  const missing = parameters
    .filter((p) => p.required && values[p.name] === undefined && p.defaultValue === undefined)
    .map((p) => p.name);
  if (missing.length > 0) return `Missing required parameters: ${missing.join(', ')}`;
  return null;
}

/**
 * Generate an optimization suggestion based on query structure.
 * Detects common anti-patterns: SELECT *, large LIMIT without ORDER, etc.
 * @param query - Query string to analyze
 * @returns Array of optimization suggestions
 */
export function analyzeQueryForOptimizations(query: string): TemplateOptimization[] {
  const suggestions: TemplateOptimization[] = [];
  const lower = query.toLowerCase();

  if (lower.includes('limit') && !lower.includes('order by')) {
    suggestions.push({
      templateId: '',
      suggestion: 'Add ORDER BY to ensure deterministic pagination with LIMIT',
      impactLevel: 'medium',
      reason: 'LIMIT without ORDER BY returns non-deterministic results across query runs',
    });
  }

  if (lower.includes('select *')) {
    suggestions.push({
      templateId: '',
      suggestion: 'Specify explicit column names instead of SELECT *',
      impactLevel: 'low',
      reason: 'SELECT * fetches unnecessary columns and breaks when schema changes',
    });
  }

  if (!lower.includes('limit')) {
    suggestions.push({
      templateId: '',
      suggestion: 'Add a LIMIT clause to bound result set size',
      impactLevel: 'high',
      reason: 'Unbounded queries can return very large result sets, increasing token costs',
    });
  }

  return suggestions;
}

/**
 * Generate a natural-language description of a parameterized query.
 * Used as a fallback when no LLM is available.
 * @param name - Template name
 * @param parameters - Template parameters
 */
export function generateTemplateDescription(name: string, parameters: TemplateParameter[]): string {
  const paramDesc = parameters.length > 0
    ? ` with parameters: ${parameters.map((p) => p.name).join(', ')}`
    : '';
  return `Query template: "${name}"${paramDesc}.`;
}

// ─── QueryTemplateManager ─────────────────────────────────────────────────────

export class QueryTemplateManager {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  /**
   * Create and save a new query template.
   */
  async createTemplate(
    name: string,
    query: string,
    parameters: TemplateParameter[],
    description: string,
    tags: string[],
    visibility: TemplateVisibility,
    workspaceId: string,
    createdBy: string,
  ): Promise<Result<QueryTemplate, Error>> {
    const id = randomUUID();
    try {
      await this.sql`
        INSERT INTO query_templates (id, name, query, parameters, description, tags, visibility, workspace_id, created_by)
        VALUES (${id}, ${name}, ${query}, ${JSON.stringify(parameters)}, ${description}, ${JSON.stringify(tags)}, ${visibility}, ${workspaceId}, ${createdBy})
      `;
      log.info('Template created', { id, name, workspaceId });
      return ok({ id, name, query, parameters, description, tags, visibility, workspaceId, createdBy, createdAt: new Date(), usageCount: 0 });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Instantiate a template with bound parameter values.
   */
  async instantiateTemplate(
    templateId: string,
    parameterValues: Record<string, unknown>,
  ): Promise<Result<TemplateInstantiation, Error>> {
    try {
      type Row = { query: string; parameters: TemplateParameter[] };
      const [row] = await this.sql<Row[]>`
        SELECT query, parameters FROM query_templates WHERE id = ${templateId}
      `;
      if (!row) return err(new Error(`Template ${templateId} not found`));

      const params: TemplateParameter[] = Array.isArray(row.parameters) ? row.parameters : JSON.parse(row.parameters as unknown as string);
      const validationError = validateParameterValues(params, parameterValues);
      if (validationError) return err(new Error(validationError));

      // Apply defaults for optional missing parameters
      const merged: Record<string, unknown> = { ...parameterValues };
      for (const p of params) {
        if (merged[p.name] === undefined && p.defaultValue !== undefined) {
          merged[p.name] = p.defaultValue;
        }
      }

      const boundQuery = bindParameters(row.query, merged);
      await this.trackTemplateUsage(templateId);

      return ok({ templateId, query: boundQuery, boundParameters: merged });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Record usage of a template.
   */
  async trackTemplateUsage(templateId: string): Promise<Result<void, Error>> {
    try {
      await this.sql`
        INSERT INTO template_usage (id, template_id, used_at)
        VALUES (${randomUUID()}, ${templateId}, NOW())
      `;
      await this.sql`
        UPDATE query_templates SET usage_count = usage_count + 1 WHERE id = ${templateId}
      `;
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * List templates with optional search and filtering.
   */
  async listTemplates(
    workspaceId: string,
    options: { search?: string; tags?: string[]; visibility?: TemplateVisibility; limit?: number; cursor?: string },
  ): Promise<Result<{ templates: QueryTemplate[]; nextCursor: string | null }, Error>> {
    const limit = Math.min(options.limit ?? 50, 200);
    try {
      type Row = { id: string; name: string; query: string; parameters: unknown; description: string; tags: unknown; visibility: string; workspace_id: string; created_by: string; created_at: Date; usage_count: number };
      const rows = await this.sql<Row[]>`
        SELECT id, name, query, parameters, description, tags, visibility, workspace_id, created_by, created_at, usage_count
        FROM query_templates
        WHERE (workspace_id = ${workspaceId} OR visibility = 'public')
          AND (${options.search ? this.sql`name ILIKE ${'%' + options.search + '%'}` : this.sql`TRUE`})
          AND (${options.visibility ? this.sql`visibility = ${options.visibility}` : this.sql`TRUE`})
          AND (${options.cursor ? this.sql`id > ${options.cursor}` : this.sql`TRUE`})
        ORDER BY id
        LIMIT ${limit + 1}
      `;

      const hasMore = rows.length > limit;
      const slice = rows.slice(0, limit);
      const nextCursor = hasMore ? (slice[slice.length - 1]?.id ?? null) : null;

      return ok({
        templates: slice.map((r) => ({
          id: r.id,
          name: r.name,
          query: r.query,
          parameters: (Array.isArray(r.parameters) ? r.parameters : JSON.parse(r.parameters as unknown as string)) as TemplateParameter[],
          description: r.description,
          tags: (Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags as unknown as string)) as string[],
          visibility: r.visibility as TemplateVisibility,
          workspaceId: r.workspace_id,
          createdBy: r.created_by,
          createdAt: r.created_at,
          usageCount: r.usage_count,
        })),
        nextCursor,
      });
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Suggest optimizations for a template based on its query structure and usage.
   */
  async suggestOptimizations(templateId: string): Promise<Result<TemplateOptimization[], Error>> {
    try {
      type Row = { query: string };
      const [row] = await this.sql<Row[]>`SELECT query FROM query_templates WHERE id = ${templateId}`;
      if (!row) return err(new Error(`Template ${templateId} not found`));
      const suggestions = analyzeQueryForOptimizations(row.query);
      return ok(suggestions.map((s) => ({ ...s, templateId })));
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
