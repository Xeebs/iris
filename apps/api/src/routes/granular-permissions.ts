import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Sql } from 'postgres';
import { logger } from '@iris/core/logger';

const log = logger.child({ service: 'granular-permissions-routes' });

const DefineFieldPermSchema = z.object({
  workspaceId: z.string().min(1),
  entityType: z.string().min(1),
  fieldName: z.string().min(1),
  permissionType: z.enum(['view', 'edit', 'delete']).default('view'),
  roleIds: z.array(z.string().min(1)).min(1),
});

const DefineConnectorPermSchema = z.object({
  workspaceId: z.string().min(1),
  connectorId: z.string().min(1),
  roleIds: z.array(z.string().min(1)).min(1),
});

type FieldPermRow = {
  permission_id: string;
  workspace_id: string;
  entity_type: string;
  field_name: string;
  permission_type: string;
  role_ids_json: string[];
  created_at: Date;
};

type ConnectorPermRow = {
  permission_id: string;
  workspace_id: string;
  connector_id: string;
  role_ids_json: string[];
  created_at: Date;
};

/**
 * @param sql - Postgres sql instance
 * @returns Hono router for granular permissions endpoints
 */
export function createGranularPermissionsRoutes(sql: Sql) {
  const app = new Hono();

  // GET /permissions/fields — list all field permissions
  app.get('/fields', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';
    const entityType = c.req.query('entityType');

    try {
      let rows: FieldPermRow[];
      if (entityType) {
        rows = await sql`
          SELECT permission_id, workspace_id, entity_type, field_name, permission_type, role_ids_json, created_at
          FROM field_permissions
          WHERE workspace_id = ${workspaceId} AND entity_type = ${entityType}
          ORDER BY entity_type, field_name
        ` as FieldPermRow[];
      } else {
        rows = await sql`
          SELECT permission_id, workspace_id, entity_type, field_name, permission_type, role_ids_json, created_at
          FROM field_permissions
          WHERE workspace_id = ${workspaceId}
          ORDER BY entity_type, field_name
        ` as FieldPermRow[];
      }

      return c.json({
        data: rows.map((r) => ({
          permissionId: r.permission_id,
          entityType: r.entity_type,
          fieldName: r.field_name,
          permissionType: r.permission_type,
          roleIds: r.role_ids_json,
          createdAt: r.created_at,
        })),
        meta: { total: rows.length },
      });
    } catch (err) {
      log.error('Failed to list field permissions', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to list field permissions' } }, 500);
    }
  });

  // POST /permissions/fields — define a new field permission
  app.post('/fields', zValidator('json', DefineFieldPermSchema), async (c) => {
    const { workspaceId, entityType, fieldName, permissionType, roleIds } = c.req.valid('json');
    const permissionId = `fp:${workspaceId}:${entityType}:${fieldName}:${permissionType}`;

    try {
      await sql`
        INSERT INTO field_permissions (permission_id, workspace_id, entity_type, field_name, permission_type, role_ids_json)
        VALUES (${permissionId}, ${workspaceId}, ${entityType}, ${fieldName}, ${permissionType}, ${JSON.stringify(roleIds)})
        ON CONFLICT (workspace_id, entity_type, field_name, permission_type)
        DO UPDATE SET role_ids_json = EXCLUDED.role_ids_json
      `;

      log.info('Field permission defined', { permissionId, workspaceId, entityType, fieldName });
      return c.json({ data: { permissionId, entityType, fieldName, permissionType, roleIds } }, 201);
    } catch (err) {
      log.error('Failed to define field permission', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'CREATE_FAILED', message: 'Failed to define field permission' } }, 500);
    }
  });

  // DELETE /permissions/fields/:id — revoke a field permission
  app.delete('/fields/:id', async (c) => {
    const permissionId = c.req.param('id');
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      await sql`DELETE FROM field_permissions WHERE permission_id = ${permissionId} AND workspace_id = ${workspaceId}`;
      log.info('Field permission revoked', { permissionId, workspaceId });
      return c.json({ data: { permissionId, revoked: true } });
    } catch (err) {
      log.error('Failed to revoke field permission', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'DELETE_FAILED', message: 'Failed to revoke field permission' } }, 500);
    }
  });

  // GET /permissions/connectors — list connector permissions
  app.get('/connectors', async (c) => {
    const workspaceId = c.req.query('workspaceId') ?? 'default';

    try {
      const rows = await sql`
        SELECT permission_id, workspace_id, connector_id, role_ids_json, created_at
        FROM connector_permissions
        WHERE workspace_id = ${workspaceId}
        ORDER BY connector_id
      ` as ConnectorPermRow[];

      return c.json({
        data: rows.map((r) => ({
          permissionId: r.permission_id,
          connectorId: r.connector_id,
          roleIds: r.role_ids_json,
          createdAt: r.created_at,
        })),
        meta: { total: rows.length },
      });
    } catch (err) {
      log.error('Failed to list connector permissions', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'FETCH_FAILED', message: 'Failed to list connector permissions' } }, 500);
    }
  });

  // POST /permissions/connectors — define connector permission
  app.post('/connectors', zValidator('json', DefineConnectorPermSchema), async (c) => {
    const { workspaceId, connectorId, roleIds } = c.req.valid('json');
    const permissionId = `cp:${workspaceId}:${connectorId}`;

    try {
      await sql`
        INSERT INTO connector_permissions (permission_id, workspace_id, connector_id, role_ids_json)
        VALUES (${permissionId}, ${workspaceId}, ${connectorId}, ${JSON.stringify(roleIds)})
        ON CONFLICT (workspace_id, connector_id) DO UPDATE SET role_ids_json = EXCLUDED.role_ids_json
      `;

      log.info('Connector permission defined', { permissionId, workspaceId, connectorId });
      return c.json({ data: { permissionId, connectorId, roleIds } }, 201);
    } catch (err) {
      log.error('Failed to define connector permission', { error: err instanceof Error ? err.message : String(err) });
      return c.json({ error: { code: 'CREATE_FAILED', message: 'Failed to define connector permission' } }, 500);
    }
  });

  return app;
}
