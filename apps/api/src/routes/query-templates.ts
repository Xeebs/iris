import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { QueryTemplateManager } from '@iris/semantic-core/query-templates';
import type { TemplateVisibility } from '@iris/semantic-core/query-templates';

const ParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'entity_type']),
  required: z.boolean(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  query: z.string().min(1),
  parameters: z.array(ParameterSchema).optional().default([]),
  description: z.string().optional().default(''),
  tags: z.array(z.string()).optional().default([]),
  visibility: z.enum(['private', 'workspace', 'public']).optional().default('workspace'),
  createdBy: z.string().min(1),
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['private', 'workspace', 'public']).optional(),
});

const InstantiateSchema = z.object({
  parameters: z.record(z.unknown()),
});

/**
 * @param sql - Postgres client
 * @returns Hono router for /api/v1/templates
 */
export function makeQueryTemplatesRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const mgr = new QueryTemplateManager(sql);

  // GET / — list templates with search/filter
  app.get('/', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const search = c.req.query('search');
    const visibility = c.req.query('visibility') as TemplateVisibility | undefined;
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const cursor = c.req.query('cursor') ?? undefined;
    const result = await mgr.listTemplates(workspaceId, { search, visibility, limit, cursor });
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    const { templates, nextCursor } = result.value;
    return c.json({ data: templates, meta: { hasMore: nextCursor !== null, nextCursor } });
  });

  // POST / — create template
  app.post('/', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const parsed = CreateTemplateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { name, query, parameters, description, tags, visibility, createdBy } = parsed.data;
    const result = await mgr.createTemplate(name, query, parameters, description, tags, visibility, workspaceId, createdBy);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value }, 201);
  });

  // PUT /:id — update template metadata
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const parsed = UpdateTemplateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    try {
      const { name, description, tags, visibility } = parsed.data;
      await sql`
        UPDATE query_templates
        SET
          name = COALESCE(${name ?? null}, name),
          description = COALESCE(${description ?? null}, description),
          tags = COALESCE(${tags ? JSON.stringify(tags) : null}::jsonb, tags),
          visibility = COALESCE(${visibility ?? null}, visibility),
          updated_at = NOW()
        WHERE id = ${id}
      `;
      return c.json({ data: { id, updated: true } });
    } catch (e) {
      return c.json({ error: { code: 'db_error', message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // POST /:id/instantiate — bind parameters and return bound query
  app.post('/:id/instantiate', async (c) => {
    const id = c.req.param('id');
    const parsed = InstantiateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await mgr.instantiateTemplate(id, parsed.data.parameters);
    if (result.isErr()) return c.json({ error: { code: 'instantiation_error', message: result.error.message } }, 422);
    return c.json({ data: result.value });
  });

  // GET /:id/analytics — usage stats + optimization suggestions
  app.get('/:id/analytics', async (c) => {
    const id = c.req.param('id');
    const [suggestResult, usageResult] = await Promise.all([
      mgr.suggestOptimizations(id),
      (async () => {
        type Row = { total_uses: number; last_used_at: Date | null };
        return sql<Row[]>`
          SELECT COUNT(*)::int AS total_uses, MAX(used_at) AS last_used_at
          FROM template_usage WHERE template_id = ${id}
        `;
      })(),
    ]);

    if (suggestResult.isErr()) return c.json({ error: { code: 'db_error', message: suggestResult.error.message } }, 500);

    const usage = usageResult[0] ?? { total_uses: 0, last_used_at: null };
    return c.json({
      data: {
        templateId: id,
        totalUses: usage.total_uses,
        lastUsedAt: usage.last_used_at,
        optimizationSuggestions: suggestResult.value,
      },
    });
  });

  return app;
}
