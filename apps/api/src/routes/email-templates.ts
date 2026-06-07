import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { EmailTemplateService } from '@iris/semantic-core/email-templates';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'email-templates' });
type SqlClient = ReturnType<typeof postgres>;

const templateBodySchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
  textBody: z.string().min(1),
  variables: z.array(z.string()).optional(),
  isDefault: z.boolean().optional(),
});

const renderBodySchema = z.object({
  templateId: z.string().uuid().nullable().optional(),
  variables: z.record(z.string()),
});

/**
 * CRUD routes for email templates.
 * Mounted under /api/v1/email-templates.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createEmailTemplateRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const service = new EmailTemplateService(sql as ConstructorParameters<typeof EmailTemplateService>[0]);

  /** GET /api/v1/email-templates — list all templates */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const result = await service.list(workspaceId);
    if (result.isErr()) {
      log.error('Failed to list email templates', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list templates' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** GET /api/v1/email-templates/:id — get a single template */
  app.get('/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { id } = c.req.param();
    const result = await service.get(workspaceId, id);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to get template' } }, 500);
    if (!result.value) return c.json({ error: { code: 'NOT_FOUND', message: 'Template not found' } }, 404);
    return c.json({ data: result.value });
  });

  /** POST /api/v1/email-templates — create a template */
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: z.infer<typeof templateBodySchema>;
    try { body = templateBodySchema.parse(await c.req.json()); }
    catch (e) { return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400); }

    const result = await service.create(workspaceId, {
      name: body.name,
      subject: body.subject,
      htmlBody: body.htmlBody,
      textBody: body.textBody,
      ...(body.variables ? { variables: body.variables } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    });
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('unique') || msg.includes('already exists')) {
        return c.json({ error: { code: 'CONFLICT', message: 'Template name already exists' } }, 409);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to create template' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** PUT /api/v1/email-templates/:name — upsert a template by name */
  app.put('/:name', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { name } = c.req.param();
    let body: Omit<z.infer<typeof templateBodySchema>, 'name'>;
    try {
      const raw = templateBodySchema.omit({ name: true }).parse(await c.req.json());
      body = raw;
    } catch (e) { return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400); }

    const result = await service.upsert(workspaceId, {
      name,
      subject: body.subject,
      htmlBody: body.htmlBody,
      textBody: body.textBody,
      ...(body.variables ? { variables: body.variables } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    });
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to upsert template' } }, 500);
    return c.json({ data: result.value });
  });

  /** DELETE /api/v1/email-templates/:id — delete a template */
  app.delete('/:id', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { id } = c.req.param();
    const result = await service.delete(workspaceId, id);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to delete template' } }, 500);
    return c.json({ data: { deleted: true, id } });
  });

  /** POST /api/v1/email-templates/render — render a template with variables */
  app.post('/render', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: z.infer<typeof renderBodySchema>;
    try { body = renderBodySchema.parse(await c.req.json()); }
    catch (e) { return c.json({ error: { code: 'VALIDATION_ERROR', message: String(e) } }, 400); }

    const result = await service.render(workspaceId, body.templateId ?? null, body.variables);
    if (result.isErr()) {
      if (result.error.message.includes('not found')) {
        return c.json({ error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Render failed' } }, 500);
    }
    return c.json({ data: result.value });
  });

  return app;
}
