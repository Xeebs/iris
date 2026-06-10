import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Sql } from 'postgres';
import { MultiTenantManager } from '@iris/semantic-core/multi-tenant-manager';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'workspace-costs' });

const periodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
});

/**
 * Build a CostStore backed by Postgres for use in route handlers.
 *
 * @param sql - Postgres client
 */
function buildCostStore(sql: Sql) {
  return {
    async recordCost(entry: {
      workspaceId: string;
      date: string;
      costCategory: string;
      amountCents: number;
      metadata: Record<string, unknown>;
    }): Promise<void> {
      await sql`
        INSERT INTO workspace_cost_attribution
          (workspace_id, date, cost_category, amount_cents, metadata_json)
        VALUES (
          ${entry.workspaceId}::uuid,
          ${entry.date}::date,
          ${entry.costCategory},
          ${entry.amountCents},
          ${sql.json(entry.metadata as Parameters<typeof sql.json>[0])}
        )
      `;
    },

    async getCosts(workspaceId: string, from: Date, to: Date) {
      const rows = await sql<
        {
          workspace_id: string;
          date: string;
          cost_category: string;
          amount_cents: string;
          metadata_json: Record<string, unknown>;
        }[]
      >`
        SELECT workspace_id, date::text, cost_category, amount_cents, metadata_json
        FROM workspace_cost_attribution
        WHERE workspace_id = ${workspaceId}::uuid
          AND date BETWEEN ${from.toISOString().slice(0, 10)}::date
                       AND ${to.toISOString().slice(0, 10)}::date
        ORDER BY date ASC
      `;
      return rows.map((r) => ({
        workspaceId: r.workspace_id,
        date: r.date,
        costCategory: r.cost_category as 'embeddings' | 'queries' | 'storage' | 'cache_miss',
        amountCents: parseFloat(r.amount_cents),
        metadata: r.metadata_json,
      }));
    },

    async getEntityWorkspace(entityId: string): Promise<string | null> {
      const rows = await sql<{ workspace_id: string }[]>`
        SELECT workspace_id FROM semantic_entities WHERE entity_id = ${entityId} LIMIT 1
      `;
      return rows[0]?.workspace_id ?? null;
    },
  };
}

/**
 * Factory for workspace cost routes.
 *
 * @param sql - Postgres client
 */
export function createWorkspaceCostRoutes(sql: Sql) {
  const app = new Hono();

  // GET /api/v1/workspaces/:id/costs?from=&to=
  app.get(
    '/:id/costs',
    zValidator('query', periodSchema),
    async (c) => {
      const workspaceId = c.req.param('id');
      const { from, to } = c.req.valid('query');

      try {
        const manager = new MultiTenantManager(buildCostStore(sql));
        const summary = await manager.computeWorkspaceCosts(
          workspaceId,
          new Date(from),
          new Date(to),
        );
        return c.json({ data: summary });
      } catch (error) {
        log.error('Failed to compute workspace costs', { workspaceId, error });
        return c.json({ error: { code: 'COST_FETCH_ERROR', message: 'Failed to retrieve costs' } }, 500);
      }
    },
  );

  // GET /api/v1/workspaces/:id/cost-breakdown?from=&to=
  app.get(
    '/:id/cost-breakdown',
    zValidator('query', periodSchema),
    async (c) => {
      const workspaceId = c.req.param('id');
      const { from, to } = c.req.valid('query');

      try {
        const store = buildCostStore(sql);
        const entries = await store.getCosts(workspaceId, new Date(from), new Date(to));

        const byDay = new Map<string, Record<string, number>>();
        for (const entry of entries) {
          if (!byDay.has(entry.date)) byDay.set(entry.date, {});
          const day = byDay.get(entry.date)!;
          day[entry.costCategory] = (day[entry.costCategory] ?? 0) + entry.amountCents;
        }

        const breakdown = [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, categories]) => ({ date, ...categories }));

        return c.json({ data: breakdown });
      } catch (error) {
        log.error('Failed to compute cost breakdown', { workspaceId, error });
        return c.json({ error: { code: 'BREAKDOWN_ERROR', message: 'Failed to retrieve breakdown' } }, 500);
      }
    },
  );

  return app;
}
