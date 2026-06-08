import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { PermissionManager, ROLE_TEMPLATES } from '@iris/semantic-core/permission-manager';

const DefinePermissionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  conditions: z.record(z.string()).nullable().optional(),
});

const GrantRevokeSchema = z.object({
  permissionName: z.string().min(1),
  actor: z.string().min(1),
});

const ApplyTemplateSchema = z.object({
  templateName: z.enum(['viewer', 'analyst', 'connector_admin', 'admin']),
  actor: z.string().min(1),
});

const EvaluateSchema = z.object({
  userId: z.string().min(1),
  permissionName: z.string().min(1),
  context: z.record(z.string()).optional(),
});

/**
 * @param sql Postgres client
 * @returns Hono router for /api/v1/permissions
 */
export function makePermissionRouter(sql: ReturnType<typeof postgres>) {
  const app = new Hono();
  const mgr = new PermissionManager(sql);

  // GET /permissions — list all defined permissions
  app.get('/', async (c) => {
    type Row = { id: string; name: string; resource: string; action: string; conditions: unknown; description: string };
    const rows = await sql<Row[]>`SELECT id, name, resource, action, conditions, description FROM permissions ORDER BY resource, action`;
    return c.json({ data: rows });
  });

  // POST /permissions — define a new permission
  app.post('/', async (c) => {
    const parsed = DefinePermissionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { name, description, conditions } = parsed.data;
    const result = await mgr.definePermission(name, description, conditions ?? null);
    if (result.isErr()) return c.json({ error: { code: 'invalid_permission', message: result.error.message } }, 422);
    return c.json({ data: result.value }, 201);
  });

  // GET /permissions/templates — list role templates
  app.get('/templates', (c) => {
    const templates = Object.entries(ROLE_TEMPLATES).map(([name, permissions]) => ({ name, permissions }));
    return c.json({ data: templates });
  });

  // POST /permissions/evaluate — check if user has a permission
  app.post('/evaluate', async (c) => {
    const parsed = EvaluateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { userId, permissionName, context } = parsed.data;
    const result = await mgr.evaluateUserPermission(userId, permissionName, context ?? {});
    if (result.isErr()) return c.json({ error: { code: 'evaluation_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /permissions/roles/:roleId — list permissions for a role
  app.get('/roles/:roleId', async (c) => {
    const roleId = c.req.param('roleId');
    const result = await mgr.listRolePermissions(roleId);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // POST /permissions/roles/:roleId/grant — grant a permission to a role
  app.post('/roles/:roleId/grant', async (c) => {
    const roleId = c.req.param('roleId');
    const parsed = GrantRevokeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { permissionName, actor } = parsed.data;
    const result = await mgr.grantPermission(roleId, permissionName, actor);
    if (result.isErr()) return c.json({ error: { code: 'grant_error', message: result.error.message } }, 500);
    return c.json({ data: { granted: true, roleId, permissionName } });
  });

  // POST /permissions/roles/:roleId/revoke — revoke a permission from a role
  app.post('/roles/:roleId/revoke', async (c) => {
    const roleId = c.req.param('roleId');
    const parsed = GrantRevokeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { permissionName, actor } = parsed.data;
    const result = await mgr.revokePermission(roleId, permissionName, actor);
    if (result.isErr()) return c.json({ error: { code: 'revoke_error', message: result.error.message } }, 500);
    return c.json({ data: { revoked: true, roleId, permissionName } });
  });

  // POST /permissions/roles/:roleId/apply-template — apply a built-in role template
  app.post('/roles/:roleId/apply-template', async (c) => {
    const roleId = c.req.param('roleId');
    const parsed = ApplyTemplateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { templateName, actor } = parsed.data;
    const result = await mgr.applyRoleTemplate(roleId, templateName, actor);
    if (result.isErr()) return c.json({ error: { code: 'template_error', message: result.error.message } }, 422);
    return c.json({ data: { applied: true, roleId, templateName, permissionsGranted: result.value } });
  });

  // GET /permissions/roles/:roleId/audit — permission audit trail
  app.get('/roles/:roleId/audit', async (c) => {
    const roleId = c.req.param('roleId');
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const result = await mgr.getAuditTrail(roleId, limit);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  return app;
}
