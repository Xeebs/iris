import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'admin-cost-audit' });

const auditQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit: z.coerce.number().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

/**
 * Admin cost audit routes — aggregate cost data across all workspaces.
 * Requires admin-level API key (enforced upstream by auth middleware).
 *
 * @param sql - Postgres client
 */
export function createAdminCostAuditRoutes(sql: Sql) {
  const app = new Hono();

  // POST /api/v1/admin/cost-audit
  app.post(
    '/',
    zValidator('json', auditQuerySchema),
    async (c) => {
      const { from, to, limit, cursor } = c.req.valid('json');

      try {
        const rows = await sql<
          {
            workspace_id: string;
            total_cents: string;
            embeddings_cents: string;
            queries_cents: string;
            storage_cents: string;
            cache_miss_cents: string;
          }[]
        >`
          SELECT
            workspace_id::text,
            SUM(amount_cents)::text AS total_cents,
            SUM(CASE WHEN cost_category = 'embeddings' THEN amount_cents ELSE 0 END)::text AS embeddings_cents,
            SUM(CASE WHEN cost_category = 'queries'    THEN amount_cents ELSE 0 END)::text AS queries_cents,
            SUM(CASE WHEN cost_category = 'storage'    THEN amount_cents ELSE 0 END)::text AS storage_cents,
            SUM(CASE WHEN cost_category = 'cache_miss' THEN amount_cents ELSE 0 END)::text AS cache_miss_cents
          FROM workspace_cost_attribution
          WHERE date BETWEEN ${from}::date AND ${to}::date
            ${cursor ? sql`AND workspace_id::text > ${cursor}` : sql``}
          GROUP BY workspace_id
          ORDER BY workspace_id
          LIMIT ${limit + 1}
        `;

        const hasMore = rows.length > limit;
        const data = rows.slice(0, limit).map((r) => ({
          workspaceId: r.workspace_id,
          totalCents: parseFloat(r.total_cents),
          byCategory: {
            embeddings: parseFloat(r.embeddings_cents),
            queries: parseFloat(r.queries_cents),
            storage: parseFloat(r.storage_cents),
            cache_miss: parseFloat(r.cache_miss_cents),
          },
        }));

        const nextCursor = hasMore ? data.at(-1)?.workspaceId : undefined;

        return c.json({
          data,
          meta: { hasMore, ...(nextCursor !== undefined && { nextCursor }) },
        });
      } catch (error) {
        log.error('Admin cost audit query failed', { error });
        return c.json(
          { error: { code: 'AUDIT_ERROR', message: 'Cost audit query failed' } },
          500,
        );
      }
    },
  );

  // GET /api/v1/admin/cost-audit/top-workspaces?from=&to=&limit=
  app.get(
    '/top-workspaces',
    zValidator(
      'query',
      z.object({
        from: z.string(),
        to: z.string(),
        limit: z.coerce.number().min(1).max(50).default(10),
      }),
    ),
    async (c) => {
      const { from, to, limit } = c.req.valid('query');

      try {
        const rows = await sql<{ workspace_id: string; total_cents: string }[]>`
          SELECT workspace_id::text, SUM(amount_cents)::text AS total_cents
          FROM workspace_cost_attribution
          WHERE date BETWEEN ${from}::date AND ${to}::date
          GROUP BY workspace_id
          ORDER BY SUM(amount_cents) DESC
          LIMIT ${limit}
        `;

        return c.json({
          data: rows.map((r) => ({
            workspaceId: r.workspace_id,
            totalCents: parseFloat(r.total_cents),
          })),
        });
      } catch (error) {
        log.error('Top workspaces query failed', { error });
        return c.json(
          { error: { code: 'TOP_WORKSPACES_ERROR', message: 'Query failed' } },
          500,
        );
      }
    },
  );

  return app;
}
