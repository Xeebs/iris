import { Hono } from 'hono';
import { z } from 'zod';
import {
  parseOperation,
  hashGraphQLQuery,
  getSchemaSDL,
  buildErrorResponse,
} from '@iris/semantic-core/graphql-schema';
import {
  executeOperation,
  enforceTokenBudget,
  isAuthorized,
  type GraphQLContext,
} from '@iris/semantic-core/graphql-resolver';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'graphql' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const requestSchema = z.object({
  query: z.string().min(1).max(50_000),
  variables: z.record(z.unknown()).default({}),
  operationName: z.string().optional(),
});

/**
 * @returns Hono router for the Iris GraphQL endpoint.
 * Exposes POST /graphql for query/mutation execution and GET /graphql/schema for SDL.
 */
export function createGraphQLRoutes(sql: SqlFn) {
  const app = new Hono();

  // GET /graphql/schema — return the SDL for introspection / tooling
  app.get('/schema', c => {
    return c.text(getSchemaSDL(), 200);
  });

  // POST /graphql — execute a GraphQL operation
  app.post('', async c => {
    const workspaceId = c.req.header('x-workspace-id') ?? c.req.query('workspaceId');
    const userId = c.req.header('x-user-id') ?? 'anonymous';
    const userRole = c.req.header('x-user-role') ?? 'viewer';
    const contextBudget = parseInt(c.req.header('x-context-budget') ?? '2000', 10);

    if (!workspaceId) {
      return c.json(buildErrorResponse('x-workspace-id header or workspaceId query param is required'), 400);
    }

    const raw = await c.req.json().catch(() => ({})) as unknown;
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(buildErrorResponse(`Validation error: ${parsed.error.message}`), 400);
    }

    const { query: queryString, variables } = parsed.data;

    const operation = parseOperation(queryString);
    if (!operation) {
      return c.json(buildErrorResponse('Failed to parse GraphQL query — check syntax'), 400);
    }

    if (!isAuthorized(operation, userRole)) {
      return c.json(buildErrorResponse(`Unauthorized: ${operation.type} operations require elevated permissions`), 403);
    }

    const ctx: GraphQLContext = { sql, workspaceId, userId, contextBudget };
    const result = await executeOperation(operation, variables, ctx, queryString);

    if (result.isErr()) {
      log.error('Resolver error', { error: result.error.message });
      return c.json(buildErrorResponse(result.error.message), 500);
    }

    const response = enforceTokenBudget(result.value, contextBudget);
    const hasErrors = (response.errors?.length ?? 0) > 0;

    return c.json(response, hasErrors && !response.data ? 400 : 200);
  });

  // GET /graphql/audit — query audit log for this workspace
  app.get('/audit', async c => {
    const workspaceId = c.req.query('workspaceId');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId required' } }, 400);
    }

    try {
      const rows = await sql`
        SELECT id, operation_name, query_hash, query_cost_tokens, execution_time_ms, accessed_at
        FROM graphql_query_audit
        WHERE workspace_id = ${workspaceId}
        ORDER BY accessed_at DESC
        LIMIT ${limit}
      `;
      return c.json({ data: rows });
    } catch (e) {
      log.error('Audit log fetch failed', { error: String(e) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to fetch audit log' } }, 500);
    }
  });

  // POST /graphql/batch — execute multiple operations in one request
  app.post('/batch', async c => {
    const workspaceId = c.req.header('x-workspace-id') ?? c.req.query('workspaceId');
    const userId = c.req.header('x-user-id') ?? 'anonymous';
    const userRole = c.req.header('x-user-role') ?? 'viewer';
    const contextBudget = parseInt(c.req.header('x-context-budget') ?? '4000', 10);

    if (!workspaceId) {
      return c.json(buildErrorResponse('x-workspace-id header required'), 400);
    }

    const raw = await c.req.json().catch(() => ({})) as unknown;
    if (!Array.isArray(raw)) {
      return c.json(buildErrorResponse('Batch requests must be an array'), 400);
    }

    if (raw.length > 10) {
      return c.json(buildErrorResponse('Batch limit is 10 operations'), 400);
    }

    const ctx: GraphQLContext = { sql, workspaceId, userId, contextBudget };
    const results = await Promise.allSettled(
      raw.map(async (item: unknown) => {
        const parsed = requestSchema.safeParse(item);
        if (!parsed.success) return buildErrorResponse('Invalid batch item');

        const { query: queryString, variables } = parsed.data;
        const operation = parseOperation(queryString);
        if (!operation) return buildErrorResponse('Failed to parse query');
        if (!isAuthorized(operation, userRole)) return buildErrorResponse('Unauthorized');

        const result = await executeOperation(operation, variables, ctx, queryString);
        return result.isOk() ? enforceTokenBudget(result.value, Math.floor(contextBudget / raw.length)) : buildErrorResponse(result.error.message);
      }),
    );

    return c.json(
      results.map(r => r.status === 'fulfilled' ? r.value : buildErrorResponse('Internal error')),
    );
  });

  // GET /graphql/hash — return query hash without executing (for caching)
  app.post('/hash', async c => {
    const raw = await c.req.json().catch(() => ({})) as { query?: string };
    if (!raw.query) return c.json({ error: 'query required' }, 400);
    return c.json({ hash: hashGraphQLQuery(raw.query) });
  });

  return app;
}
