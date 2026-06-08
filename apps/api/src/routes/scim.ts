import { Hono } from 'hono';
import {
  provisionUser,
  provisionGroup,
  handleDeprovision,
  getFilteredUsers,
  getFilteredGroups,
  buildSCIMError,
  toSCIMUser,
  type SCIMUser,
  type SCIMGroup,
  type DirectoryType,
} from '@iris/semantic-core/scim-provisioner';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'scim' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const SCIM_CONTENT_TYPE = 'application/scim+json';

/** @returns Hono router for SCIM 2.0 endpoints (/scim/v2) */
export function createSCIMRoutes(sql: SqlFn) {
  const app = new Hono();

  function workspaceFromHeaders(c: { req: { header: (k: string) => string | undefined } }): string | null {
    return c.req.header('x-workspace-id') ?? null;
  }

  function directoryFromHeaders(c: { req: { header: (k: string) => string | undefined } }): DirectoryType {
    const dt = c.req.header('x-directory-type');
    if (dt === 'azure_ad' || dt === 'okta' || dt === 'google_workspace') return dt;
    return 'generic';
  }

  // GET /scim/v2/Users
  app.get('/Users', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);

    const filterStr = c.req.query('filter');
    const startIndex = parseInt(c.req.query('startIndex') ?? '1', 10);
    const count = Math.min(parseInt(c.req.query('count') ?? '100', 10), 200);

    const result = await getFilteredUsers(sql, workspaceId, filterStr, startIndex, count);
    if (result.isErr()) {
      return c.json(buildSCIMError(500, result.error.message), 500);
    }
    c.header('Content-Type', SCIM_CONTENT_TYPE);
    return c.json(result.value);
  });

  // POST /scim/v2/Users
  app.post('/Users', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);

    const body = await c.req.json().catch(() => null) as SCIMUser | null;
    if (!body?.userName) return c.json(buildSCIMError(400, 'userName is required', 'invalidValue'), 400);

    const result = await provisionUser(sql, workspaceId, body, directoryFromHeaders(c));
    if (result.isErr()) {
      log.error('SCIM user provision failed', { error: result.error.message });
      return c.json(buildSCIMError(500, result.error.message), 500);
    }

    const user = result.value;
    c.header('Content-Type', SCIM_CONTENT_TYPE);
    c.header('Location', `/scim/v2/Users/${user.userId}`);
    return c.json(toSCIMUser(user, `/scim/v2/Users/${user.userId}`), 201);
  });

  // GET /scim/v2/Users/:id
  app.get('/Users/:id', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);
    const userId = c.req.param('id');

    try {
      const rows = await sql`
        SELECT user_id, external_user_id, directory_type, user_name, display_name,
               email, active, iris_role, synced_at
        FROM scim_provisioned_users
        WHERE workspace_id = ${workspaceId} AND user_id = ${userId}
        LIMIT 1
      ` as unknown as Array<{
        user_id: string; external_user_id: string; directory_type: DirectoryType;
        user_name: string; display_name: string; email: string;
        active: boolean; iris_role: string; synced_at: string;
      }>;

      if (rows.length === 0) return c.json(buildSCIMError(404, 'User not found'), 404);

      const r = rows[0]!;
      const user = {
        userId: r.user_id, externalUserId: r.external_user_id, directoryType: r.directory_type,
        userName: r.user_name, displayName: r.display_name, email: r.email,
        active: r.active, irisRole: r.iris_role, workspaceId, syncedAt: new Date(r.synced_at),
      };
      c.header('Content-Type', SCIM_CONTENT_TYPE);
      return c.json(toSCIMUser(user, `/scim/v2/Users/${userId}`));
    } catch (e) {
      return c.json(buildSCIMError(500, String(e)), 500);
    }
  });

  // PUT /scim/v2/Users/:id — full replacement
  app.put('/Users/:id', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);

    const body = await c.req.json().catch(() => null) as SCIMUser | null;
    if (!body?.userName) return c.json(buildSCIMError(400, 'userName is required', 'invalidValue'), 400);

    const result = await provisionUser(sql, workspaceId, { ...body, id: c.req.param('id') }, directoryFromHeaders(c));
    if (result.isErr()) return c.json(buildSCIMError(500, result.error.message), 500);

    c.header('Content-Type', SCIM_CONTENT_TYPE);
    return c.json(toSCIMUser(result.value, `/scim/v2/Users/${result.value.userId}`));
  });

  // DELETE /scim/v2/Users/:id
  app.delete('/Users/:id', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);

    const result = await handleDeprovision(sql, workspaceId, c.req.param('id'));
    if (result.isErr()) return c.json(buildSCIMError(500, result.error.message), 500);
    return c.body(null, 204);
  });

  // GET /scim/v2/Groups
  app.get('/Groups', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);

    const result = await getFilteredGroups(sql, workspaceId, c.req.query('filter'));
    if (result.isErr()) return c.json(buildSCIMError(500, result.error.message), 500);

    c.header('Content-Type', SCIM_CONTENT_TYPE);
    return c.json(result.value);
  });

  // POST /scim/v2/Groups
  app.post('/Groups', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);

    const body = await c.req.json().catch(() => null) as SCIMGroup | null;
    if (!body?.displayName) return c.json(buildSCIMError(400, 'displayName is required', 'invalidValue'), 400);

    const result = await provisionGroup(sql, workspaceId, body, directoryFromHeaders(c));
    if (result.isErr()) return c.json(buildSCIMError(500, result.error.message), 500);

    const { groupName, irisRole } = result.value;
    c.header('Content-Type', SCIM_CONTENT_TYPE);
    return c.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: body.externalId ?? groupName,
      displayName: groupName,
      meta: { resourceType: 'Group' },
      'urn:iris:extension:role': irisRole,
    }, 201);
  });

  // GET /scim/v2/Groups/:id
  app.get('/Groups/:id', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);
    const groupId = c.req.param('id');

    try {
      const rows = await sql`
        SELECT group_name, external_group_id, iris_role
        FROM scim_group_mappings
        WHERE workspace_id = ${workspaceId}
          AND (external_group_id = ${groupId} OR group_name = ${groupId})
        LIMIT 1
      ` as unknown as Array<{ group_name: string; external_group_id: string; iris_role: string }>;

      if (rows.length === 0) return c.json(buildSCIMError(404, 'Group not found'), 404);
      const r = rows[0]!;
      c.header('Content-Type', SCIM_CONTENT_TYPE);
      return c.json({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        id: r.external_group_id,
        displayName: r.group_name,
        'urn:iris:extension:role': r.iris_role,
      });
    } catch (e) {
      return c.json(buildSCIMError(500, String(e)), 500);
    }
  });

  // DELETE /scim/v2/Groups/:id
  app.delete('/Groups/:id', async c => {
    const workspaceId = workspaceFromHeaders(c);
    if (!workspaceId) return c.json(buildSCIMError(400, 'x-workspace-id header required'), 400);
    const groupId = c.req.param('id');

    try {
      await sql`
        DELETE FROM scim_group_mappings
        WHERE workspace_id = ${workspaceId} AND external_group_id = ${groupId}
      `;
      return c.body(null, 204);
    } catch (e) {
      return c.json(buildSCIMError(500, String(e)), 500);
    }
  });

  // GET /scim/v2/ServiceProviderConfig — advertise capabilities
  app.get('/ServiceProviderConfig', c => {
    return c.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: false },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Iris API key' }],
    });
  });

  return app;
}
