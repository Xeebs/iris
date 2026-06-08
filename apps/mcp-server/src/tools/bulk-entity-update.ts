import { z } from 'zod';

export const bulkEntityUpdateSchema = z.object({
  filter: z.object({
    type: z.string().optional(),
    labelContains: z.string().optional(),
    workspaceId: z.string().default('default'),
  }),
  patch: z.record(z.string(), z.unknown()),
  dryRun: z.boolean().default(false),
});

export type BulkEntityUpdateInput = z.infer<typeof bulkEntityUpdateSchema>;

export type BulkEntityUpdateResult = {
  matchedCount: number;
  updatedCount: number;
  dryRun: boolean;
  affectedIds: string[];
};

/**
 * MCP tool: bulk-entity-update
 *
 * Updates attributes on multiple entities matching a filter in one operation.
 * Supports dry-run mode to preview affected entities before committing.
 */
export const bulkEntityUpdateTool = {
  name: 'bulk-entity-update',
  description: 'Update attributes on multiple entities matching a filter. Use dryRun=true to preview changes without committing.',
  inputSchema: bulkEntityUpdateSchema,

  async execute(
    input: BulkEntityUpdateInput,
    deps: { sql: import('postgres').Sql },
  ): Promise<{ content: [{ type: 'text'; text: string }] }> {
    const { filter, patch, dryRun } = input;
    const { sql } = deps;

    // Build WHERE clause conditions
    type EntityRow = { id: string };
    const conditions: string[] = [`workspace_id = '${filter.workspaceId}'`];
    if (filter.type) conditions.push(`type = '${filter.type}'`);
    if (filter.labelContains) conditions.push(`label ILIKE '%${filter.labelContains}%'`);

    const matching = await sql<EntityRow[]>`
      SELECT id FROM iris_entities
      WHERE workspace_id = ${filter.workspaceId}
        ${filter.type ? sql`AND type = ${filter.type}` : sql``}
        ${filter.labelContains ? sql`AND label ILIKE ${'%' + filter.labelContains + '%'}` : sql``}
      LIMIT 500
    `;

    if (dryRun || matching.length === 0) {
      const result: BulkEntityUpdateResult = {
        matchedCount: matching.length,
        updatedCount: 0,
        dryRun: true,
        affectedIds: matching.map((r) => r.id),
      };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    const ids = matching.map((r) => r.id);
    await sql`
      UPDATE iris_entities
      SET attributes = attributes || ${JSON.stringify(patch)}::jsonb,
          last_modified = NOW()
      WHERE id = ANY(${ids}::text[])
    `;

    const result: BulkEntityUpdateResult = {
      matchedCount: matching.length,
      updatedCount: ids.length,
      dryRun: false,
      affectedIds: ids,
    };
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
};
