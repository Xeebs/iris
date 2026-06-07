import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { WorkflowTemplateService, createTemplateSchema } from '@iris/semantic-core/workflow-templates';

type SqlClient = ReturnType<typeof postgres>;

const updateSchema = createTemplateSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/**
 * CRUD routes for agent workflow templates.
 *
 * @param sql - Postgres client
 * @returns Hono router mounted at /workflow-templates
 */
export function createWorkflowTemplateRoutes(sql: SqlClient) {
  const app = new Hono();
  const getService = () => new WorkflowTemplateService(sql);

  /** GET /workflow-templates?workspaceId=&activeOnly= */
  app.get('/', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const activeOnly = c.req.query('activeOnly') === 'true';
    const result = await getService().listTemplates(workspaceId, activeOnly);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /workflow-templates/:id?workspaceId= */
  app.get('/:id', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const id = c.req.param('id');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const result = await getService().getTemplate(workspaceId, id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** POST /workflow-templates */
  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ workspaceId: z.string().min(1) })
      .merge(createTemplateSchema)
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { workspaceId, ...input } = parsed.data;
    const result = await getService().createTemplate(workspaceId, input);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('unique') || msg.includes('duplicate')) {
        return c.json({ error: { code: 'CONFLICT', message: 'Template name already exists in this workspace' } }, 409);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: msg } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** PUT /workflow-templates/:id */
  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ workspaceId: z.string().min(1) })
      .merge(updateSchema)
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }
    const { workspaceId, ...rawInput } = parsed.data;
    const input = Object.fromEntries(
      Object.entries(rawInput).filter(([, v]) => v !== undefined),
    ) as Parameters<ReturnType<typeof getService>['updateTemplate']>[2];
    const result = await getService().updateTemplate(workspaceId, id, input);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /workflow-templates/:id?workspaceId= */
  app.delete('/:id', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const id = c.req.param('id');
    if (!workspaceId) {
      return c.json({ error: { code: 'MISSING_WORKSPACE', message: 'workspaceId is required' } }, 400);
    }
    const result = await getService().deleteTemplate(workspaceId, id);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }
    if (!result.value) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
    }
    return c.json({ data: { deleted: true } });
  });

  return app;
}
