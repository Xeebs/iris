import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ service: 'entity-search' });

export type FilterOperator = 'eq' | 'neq' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'gte' | 'lte';

export type ParsedFilter = {
  field: string;
  operator: FilterOperator;
  value: string;
};

export type SearchResult = {
  entityId: string;
  entityType: string;
  label: string;
  connectorId: string;
  workspaceId: string;
  attributes: Record<string, unknown>;
  score: number;
};

export type FacetCount = {
  field: string;
  value: string;
  count: number;
};

export type SearchResponse = {
  results: SearchResult[];
  total: number;
  nextCursor: string | null;
  facets: FacetCount[];
};

const WILDCARD_RE = /\*/g;

/**
 * Parse a DSL filter string into structured filter objects.
 * Supports: `type:contact`, `email:*@acme.com`, `status:active`, `amount:>1000`, `name:~John`
 * Operators: `:` → eq, `:*...*` → contains, `:*...` → endsWith, `:...*` → startsWith, `:>` → gt, `:<` → lt, `:~` → contains
 *
 * @param filterString - Space-separated filter tokens
 * @returns Array of parsed filters
 */
export function parseFilterQuery(filterString: string): ParsedFilter[] {
  const tokens = filterString.trim().split(/\s+/);
  const filters: ParsedFilter[] = [];

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx < 1) continue;

    const field = token.slice(0, colonIdx).toLowerCase();
    const rawValue = token.slice(colonIdx + 1);

    if (!field || !rawValue) continue;

    let operator: FilterOperator = 'eq';
    let value = rawValue;

    if (rawValue.startsWith('>')) {
      operator = 'gt';
      value = rawValue.slice(1);
    } else if (rawValue.startsWith('<')) {
      operator = 'lt';
      value = rawValue.slice(1);
    } else if (rawValue.startsWith('~')) {
      operator = 'contains';
      value = rawValue.slice(1);
    } else if (rawValue.startsWith('*') && rawValue.endsWith('*') && rawValue.length > 2) {
      operator = 'contains';
      value = rawValue.slice(1, -1);
    } else if (rawValue.startsWith('*')) {
      operator = 'endsWith';
      value = rawValue.slice(1);
    } else if (rawValue.endsWith('*')) {
      operator = 'startsWith';
      value = rawValue.slice(0, -1);
    }

    // Sanitize: remove any remaining wildcards from value
    value = value.replace(WILDCARD_RE, '');

    if (value) {
      filters.push({ field, operator, value });
    }
  }

  return filters;
}

/**
 * Determine which filters apply to a core column vs an attribute JSON field.
 * Core columns: id, entity_type, label, connector_id, workspace_id, source_id.
 */
const CORE_COLUMNS = new Set(['id', 'type', 'label', 'connector', 'connector_id', 'source_id', 'entity_type']);

function isCoreColumn(field: string): boolean {
  return CORE_COLUMNS.has(field);
}

function columnName(field: string): string {
  if (field === 'type') return 'entity_type';
  if (field === 'connector') return 'connector_id';
  return field;
}

/**
 * Build parameterized SQL WHERE clauses from parsed filters.
 * Uses JSONB operators for attribute fields.
 * @param filters - Parsed filter array
 * @returns { clauses, params } for safe injection into a query
 */
export function buildFilterClauses(filters: ParsedFilter[]): { clauses: string[]; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  let paramIdx = 1;

  for (const f of filters) {
    const p = () => { params.push(f.value); return `$${paramIdx++}`; };

    if (isCoreColumn(f.field)) {
      const col = columnName(f.field);
      switch (f.operator) {
        case 'eq':         clauses.push(`${col} = ${p()}`); break;
        case 'neq':        clauses.push(`${col} != ${p()}`); break;
        case 'contains':   { const ph = p(); clauses.push(`${col} ILIKE '%' || ${ph} || '%'`); break; }
        case 'startsWith': { const ph = p(); clauses.push(`${col} ILIKE ${ph} || '%'`); break; }
        case 'endsWith':   { const ph = p(); clauses.push(`${col} ILIKE '%' || ${ph}`); break; }
        case 'gt':         clauses.push(`${col} > ${p()}`); break;
        case 'lt':         clauses.push(`${col} < ${p()}`); break;
        case 'gte':        clauses.push(`${col} >= ${p()}`); break;
        case 'lte':        clauses.push(`${col} <= ${p()}`); break;
      }
    } else {
      // JSONB attribute filter
      switch (f.operator) {
        case 'eq':         clauses.push(`attributes->>'${f.field}' = ${p()}`); break;
        case 'neq':        clauses.push(`attributes->>'${f.field}' != ${p()}`); break;
        case 'contains':   { const ph = p(); clauses.push(`attributes->>'${f.field}' ILIKE '%' || ${ph} || '%'`); break; }
        case 'startsWith': { const ph = p(); clauses.push(`attributes->>'${f.field}' ILIKE ${ph} || '%'`); break; }
        case 'endsWith':   { const ph = p(); clauses.push(`attributes->>'${f.field}' ILIKE '%' || ${ph}`); break; }
        case 'gt':         clauses.push(`(attributes->>'${f.field}')::numeric > ${p()}`); break;
        case 'lt':         clauses.push(`(attributes->>'${f.field}')::numeric < ${p()}`); break;
        case 'gte':        clauses.push(`(attributes->>'${f.field}')::numeric >= ${p()}`); break;
        case 'lte':        clauses.push(`(attributes->>'${f.field}')::numeric <= ${p()}`); break;
      }
    }
  }

  return { clauses, params };
}

/**
 * Entity search engine supporting full-text search + attribute filtering.
 */
export class EntitySearchEngine {
  private readonly sql: SqlFn;

  constructor(sql: SqlFn) {
    this.sql = sql;
  }

  /**
   * Search entities using full-text query + structured filters.
   * @param workspaceId - Workspace to search within
   * @param query - Optional full-text query
   * @param filterString - DSL filter string (e.g. "type:contact status:active")
   * @param limit - Max results (default 50, max 200)
   * @param cursor - Pagination cursor (opaque string = last entity_id seen)
   */
  async searchEntities(
    workspaceId: string,
    query: string,
    filterString: string,
    limit = 50,
    cursor?: string,
  ): Promise<Result<SearchResponse, Error>> {
    const safeLimit = Math.min(200, Math.max(1, limit));
    const filters = parseFilterQuery(filterString);

    try {
      const { clauses, params } = buildFilterClauses(filters);
      const workspaceParam = workspaceId;
      const allParams: unknown[] = [workspaceParam, ...params];

      const whereParts = ['e.workspace_id = $1', ...clauses.map((c, i) => `${c.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + 1}`)}`).map((c, i) => c)];

      const hasQuery = query.trim().length > 0;
      if (hasQuery) {
        allParams.push(`%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
        whereParts.push(`(e.label ILIKE $${allParams.length} OR e.entity_type ILIKE $${allParams.length})`);
      }

      if (cursor) {
        allParams.push(cursor);
        whereParts.push(`e.id > $${allParams.length}`);
      }

      const whereStr = whereParts.join(' AND ');
      allParams.push(safeLimit + 1); // fetch +1 to detect next page

      const rows = await this.sql`
        SELECT e.id AS entity_id, e.entity_type, e.label, e.connector_id, e.workspace_id,
               e.attributes,
               ts_rank(to_tsvector('english', e.label), plainto_tsquery('english', ${query || 'iris'})) AS score
        FROM entities e
        WHERE ${whereStr}
        ORDER BY score DESC, e.id ASC
        LIMIT ${safeLimit + 1}
      ` as unknown as Array<{
        entity_id: string;
        entity_type: string;
        label: string;
        connector_id: string;
        workspace_id: string;
        attributes: Record<string, unknown> | string;
        score: number;
      }>;

      const hasMore = rows.length > safeLimit;
      const pageRows = rows.slice(0, safeLimit);
      const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.entity_id ?? null) : null;

      const results: SearchResult[] = pageRows.map(r => ({
        entityId: r.entity_id,
        entityType: r.entity_type,
        label: r.label,
        connectorId: r.connector_id,
        workspaceId: r.workspace_id,
        attributes: typeof r.attributes === 'string' ? JSON.parse(r.attributes) as Record<string, unknown> : (r.attributes ?? {}),
        score: r.score,
      }));

      const facets = await this.buildFacets(workspaceId, filters);

      log.info('Entity search complete', { workspaceId, query, filterCount: filters.length, resultCount: results.length });
      return ok({ results, total: results.length, nextCursor, facets });
    } catch (e) {
      log.error('Entity search failed', { workspaceId, error: e instanceof Error ? e.message : e });
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * Suggest applicable filter completions based on a partial query token.
   * @param partialToken - Partial filter token like "sta" or "type:"
   */
  async suggestFilters(partialToken: string): Promise<Result<string[], Error>> {
    const COMMON_FILTERS = [
      'type:contact', 'type:company', 'type:deal', 'type:activity',
      'status:active', 'status:inactive', 'status:pending',
      'connector:hubspot', 'connector:salesforce', 'connector:slack',
    ];

    const lower = partialToken.toLowerCase();
    const suggestions = COMMON_FILTERS.filter(f => f.startsWith(lower) || f.includes(lower));
    return ok(suggestions.slice(0, 10));
  }

  private async buildFacets(workspaceId: string, filters: ParsedFilter[]): Promise<FacetCount[]> {
    try {
      const rows = await this.sql`
        SELECT entity_type AS value, COUNT(*) AS count
        FROM entities
        WHERE workspace_id = ${workspaceId}
        GROUP BY entity_type
        ORDER BY count DESC
        LIMIT 10
      ` as unknown as Array<{ value: string; count: string }>;
      return rows.map(r => ({ field: 'type', value: r.value, count: parseInt(r.count, 10) }));
    } catch {
      return [];
    }
  }
}
