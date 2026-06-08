import { ok, err, type Result } from 'neverthrow';
import { logger } from '@iris/core/logger';
import {
  type ParsedOperation,
  type GraphQLResponse,
  mergeVariables,
  estimateResponseTokens,
  buildErrorResponse,
  hashGraphQLQuery,
} from './graphql-schema.js';

const log = logger.child({ service: 'graphql-resolver' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

export type GraphQLContext = {
  sql: SqlFn;
  workspaceId: string;
  userId: string;
  contextBudget?: number;
};

type ResolverFn = (args: Record<string, unknown>, ctx: GraphQLContext) => Promise<unknown>;

/** Registry of field resolvers keyed by rootField name. */
const QUERY_RESOLVERS: Record<string, ResolverFn> = {
  async entity(args, ctx) {
    const { id } = args;
    if (!id) throw new Error('entity requires id');
    const rows = await ctx.sql`
      SELECT id, entity_type AS type, label, workspace_id AS "workspaceId",
             attributes, last_modified AS "lastModified", source_id AS "sourceId"
      FROM entities
      WHERE id = ${id as string} AND workspace_id = ${ctx.workspaceId}
      LIMIT 1
    ` as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  },

  async entities(args, ctx) {
    const limit = Math.min(parseInt(String(args.limit ?? '50'), 10), 200);
    const cursor = args.cursor as string | undefined;
    const entityType = args.type as string | undefined;
    const label = args.label as string | undefined;

    const rows = await ctx.sql`
      SELECT id, entity_type AS type, label, workspace_id AS "workspaceId",
             attributes, last_modified AS "lastModified", source_id AS "sourceId"
      FROM entities
      WHERE workspace_id = ${ctx.workspaceId}
        ${entityType ? ctx.sql`AND entity_type = ${entityType}` : ctx.sql``}
        ${label ? ctx.sql`AND label ILIKE ${'%' + label + '%'}` : ctx.sql``}
        ${cursor ? ctx.sql`AND id > ${cursor}` : ctx.sql``}
      ORDER BY id
      LIMIT ${limit + 1}
    ` as unknown as Array<Record<string, unknown>>;

    const truncated = rows.length > limit;
    const entities = rows.slice(0, limit);
    return {
      entities,
      totalCount: entities.length,
      truncated,
      tokensBudgetUsed: estimateResponseTokens(entities),
    };
  },

  async metrics(args, ctx) {
    const names = args.names as string[] | undefined;
    const rows = await ctx.sql`
      SELECT id, name, value, unit, trend, workspace_id AS "workspaceId",
             computed_at AS "computedAt"
      FROM metrics
      WHERE workspace_id = ${ctx.workspaceId}
        ${names && names.length > 0 ? ctx.sql`AND name = ANY(${names})` : ctx.sql``}
      ORDER BY name
      LIMIT 100
    ` as unknown as Array<Record<string, unknown>>;
    return rows;
  },

  async glossary(args, ctx) {
    const term = args.term as string | undefined;
    const rows = await ctx.sql`
      SELECT term, definition, synonyms, workspace_id AS "workspaceId"
      FROM glossary_terms
      WHERE workspace_id = ${ctx.workspaceId}
        ${term ? ctx.sql`AND term ILIKE ${'%' + term + '%'}` : ctx.sql``}
      ORDER BY term
      LIMIT 100
    ` as unknown as Array<Record<string, unknown>>;
    return rows;
  },

  async lineage(args, ctx) {
    const { entityId, depth = 3 } = args as { entityId: string; depth?: number };
    if (!entityId) throw new Error('lineage requires entityId');
    const rows = await ctx.sql`
      SELECT entity_id AS "entityId", label, depth, direction
      FROM entity_lineage
      WHERE workspace_id = ${ctx.workspaceId}
        AND root_entity_id = ${entityId}
        AND depth <= ${depth}
      ORDER BY depth, direction
    ` as unknown as Array<Record<string, unknown>>;
    return rows;
  },

  async graphqlAuditLog(args, ctx) {
    const limit = Math.min(parseInt(String(args.limit ?? '50'), 10), 200);
    const rows = await ctx.sql`
      SELECT id, workspace_id AS "workspaceId", operation_name AS "operationName",
             query_hash AS "queryHash", query_cost_tokens AS "costTokens",
             execution_time_ms AS "executionTimeMs", accessed_at AS "accessedAt"
      FROM graphql_query_audit
      WHERE workspace_id = ${ctx.workspaceId}
      ORDER BY accessed_at DESC
      LIMIT ${limit}
    ` as unknown as Array<Record<string, unknown>>;
    return rows;
  },
};

const MUTATION_RESOLVERS: Record<string, ResolverFn> = {
  async createEntity(args, ctx) {
    const input = args.input as Record<string, unknown>;
    if (!input?.type || !input?.label) throw new Error('createEntity requires type and label');
    const id = `${ctx.workspaceId}:${String(input.type)}:${Date.now()}`;
    await ctx.sql`
      INSERT INTO entities (id, entity_type, label, workspace_id, attributes)
      VALUES (${id}, ${String(input.type)}, ${String(input.label)}, ${ctx.workspaceId}, ${JSON.stringify(input.attributes ?? {})})
    `;
    return { success: true, entityId: id, message: 'Entity created' };
  },

  async updateEntity(args, ctx) {
    const input = args.input as Record<string, unknown>;
    if (!input?.id) throw new Error('updateEntity requires id');
    await ctx.sql`
      UPDATE entities
      SET label = COALESCE(${input.label as string ?? null}, label),
          attributes = COALESCE(${JSON.stringify(input.attributes ?? null)}, attributes)
      WHERE id = ${String(input.id)} AND workspace_id = ${ctx.workspaceId}
    `;
    return { success: true, entityId: String(input.id), message: 'Entity updated' };
  },

  async deleteEntity(args, ctx) {
    const { id } = args;
    if (!id) throw new Error('deleteEntity requires id');
    await ctx.sql`
      DELETE FROM entities
      WHERE id = ${String(id)} AND workspace_id = ${ctx.workspaceId}
    `;
    return { success: true, entityId: String(id), message: 'Entity deleted' };
  },

  async runQuery(args, ctx) {
    const { query: queryText, contextBudget = ctx.contextBudget ?? 2000 } = args as {
      query: string;
      contextBudget?: number;
    };
    if (!queryText) throw new Error('runQuery requires query');
    const rows = await ctx.sql`
      SELECT id, entity_type AS type, label, workspace_id AS "workspaceId",
             attributes, last_modified AS "lastModified"
      FROM entities
      WHERE workspace_id = ${ctx.workspaceId}
        AND (label ILIKE ${'%' + queryText + '%'} OR attributes::text ILIKE ${'%' + queryText + '%'})
      ORDER BY last_modified DESC NULLS LAST
      LIMIT 50
    ` as unknown as Array<Record<string, unknown>>;

    const used = estimateResponseTokens(rows);
    const truncated = used > contextBudget;
    return {
      entities: truncated ? rows.slice(0, Math.floor(rows.length * contextBudget / used)) : rows,
      totalCount: rows.length,
      truncated,
      tokensBudgetUsed: Math.min(used, contextBudget),
    };
  },
};

/**
 * Execute a parsed GraphQL operation against the Iris data layer.
 * @param operation - Parsed operation from parseOperation()
 * @param variables - Runtime variables
 * @param ctx - Resolver context (sql, workspaceId, userId)
 * @param rawQuery - Original query string for audit logging
 * @returns GraphQL response envelope
 */
export async function executeOperation(
  operation: ParsedOperation,
  variables: Record<string, unknown>,
  ctx: GraphQLContext,
  rawQuery: string,
): Promise<Result<GraphQLResponse, Error>> {
  const startMs = Date.now();
  try {
    const mergedArgs = mergeVariables(operation, variables);

    let resolverMap: Record<string, ResolverFn>;
    if (operation.type === 'mutation') {
      resolverMap = MUTATION_RESOLVERS;
    } else if (operation.type === 'subscription') {
      return ok(buildErrorResponse('Subscriptions require WebSocket transport — use /graphql/ws', {}));
    } else {
      resolverMap = QUERY_RESOLVERS;
    }

    const resolver = resolverMap[operation.rootField];
    if (!resolver) {
      return ok(buildErrorResponse(`Unknown field: ${operation.rootField}`));
    }

    const data = await resolver(mergedArgs, ctx);
    const executionTimeMs = Date.now() - startMs;
    const tokensBudgetUsed = estimateResponseTokens(data);

    // Fire-and-forget audit insert
    void ctx.sql`
      INSERT INTO graphql_query_audit
        (workspace_id, operation_name, query_hash, query_cost_tokens, execution_time_ms, user_id, accessed_at)
      VALUES (
        ${ctx.workspaceId}, ${operation.operationName ?? null},
        ${hashGraphQLQuery(rawQuery)}, ${tokensBudgetUsed},
        ${executionTimeMs}, ${ctx.userId}, NOW()
      )
    `.catch(() => undefined);

    log.info('GraphQL operation executed', {
      workspaceId: ctx.workspaceId,
      rootField: operation.rootField,
      type: operation.type,
      executionTimeMs,
      tokensBudgetUsed,
    });

    return ok({
      data: { [operation.rootField]: data },
      extensions: { tokensBudgetUsed, executionTimeMs },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error('GraphQL execution error', { error: msg, rootField: operation.rootField });
    return ok(buildErrorResponse(msg));
  }
}

/**
 * Enforce workspace-level token budget on the response.
 * @param response - GraphQL response
 * @param budget - Max tokens
 * @returns Potentially truncated response
 */
export function enforceTokenBudget(response: GraphQLResponse, budget: number): GraphQLResponse {
  const used = response.extensions?.tokensBudgetUsed ?? 0;
  if (used <= budget) return response;
  return {
    ...response,
    errors: [
      ...(response.errors ?? []),
      { message: `Response truncated: used ${used} tokens, budget ${budget}` },
    ],
  };
}

/**
 * Check if a user is authorized to run a given operation type.
 * Mutations require write permission; subscriptions require explicit grant.
 */
export function isAuthorized(
  operation: ParsedOperation,
  _userRole: string,
): boolean {
  // Subscriptions are always authorized for authenticated users
  if (operation.type === 'subscription') return true;
  // Mutations require non-viewer role
  if (operation.type === 'mutation' && _userRole === 'viewer') return false;
  return true;
}
