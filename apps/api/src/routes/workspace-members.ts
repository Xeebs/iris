import { Hono } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { CollaborationManager } from '@iris/semantic-core/collaboration-manager';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'workspace-members' });
type SqlClient = ReturnType<typeof postgres>;

const inviteSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'editor', 'viewer']),
});

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
});

const shareResourceSchema = z.object({
  resourceType: z.enum(['connector', 'glossary', 'metric', 'workflow']),
  resourceId: z.string().min(1),
  targetUserId: z.string().min(1),
  permission: z.enum(['read', 'write']),
});

/**
 * Routes for workspace member and resource sharing management.
 * Mounted under /api/v1/workspace.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createWorkspaceMembersRoutes(sql: SqlClient): Hono {
  const app = new Hono();
  const mgr = new CollaborationManager(sql);

  /** GET /workspace/members — list all workspace members */
  app.get('/members', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const result = await mgr.listMembers(workspaceId);
    if (result.isErr()) {
      log.error('Failed to list members', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to list members' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** POST /workspace/members/invite — add a user to the workspace */
  app.post('/members/invite', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const currentUserId = c.get('userId' as never) as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400);
    }

    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await mgr.inviteUser(
      workspaceId,
      parsed.data.userId,
      parsed.data.role,
      currentUserId,
    );
    if (result.isErr()) {
      log.error('Failed to invite member', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to invite member' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** PUT /workspace/members/:userId/role — update a member's role */
  app.put('/members/:userId/role', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { userId } = c.req.param();

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400);
    }

    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await mgr.updateUserRole(workspaceId, userId, parsed.data.role);
    if (result.isErr()) {
      const msg = result.error.message;
      if (msg.includes('not a member')) {
        return c.json({ error: { code: 'NOT_FOUND', message: msg } }, 404);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to update role' } }, 500);
    }
    return c.json({ data: result.value });
  });

  /** DELETE /workspace/members/:userId — remove a member */
  app.delete('/members/:userId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { userId } = c.req.param();
    const result = await mgr.removeMember(workspaceId, userId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to remove member' } }, 500);
    }
    return c.json({ data: { removed: true } });
  });

  /** POST /workspace/shares — share a resource with a user */
  app.post('/shares', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const currentUserId = c.get('userId' as never) as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    let body: unknown;
    try { body = await c.req.json(); } catch {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400);
    }

    const parsed = shareResourceSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    }

    const result = await mgr.shareResource(
      workspaceId,
      parsed.data.resourceType,
      parsed.data.resourceId,
      parsed.data.targetUserId,
      parsed.data.permission,
      currentUserId,
    );
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to share resource' } }, 500);
    }
    return c.json({ data: result.value }, 201);
  });

  /** DELETE /workspace/shares — revoke a resource share */
  app.delete('/shares', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);

    const { resourceType, resourceId, targetUserId } = c.req.query();
    if (!resourceType || !resourceId || !targetUserId) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'resourceType, resourceId, and targetUserId are required' } }, 400);
    }

    const result = await mgr.revokeShare(
      workspaceId,
      resourceType as Parameters<typeof mgr.revokeShare>[1],
      resourceId,
      targetUserId,
    );
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke share' } }, 500);
    }
    return c.json({ data: { revoked: true } });
  });

  /** GET /workspace/permissions/check — check if current user has a permission */
  app.get('/permissions/check', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    const userId = c.get('userId' as never) as string | undefined;
    if (!workspaceId || !userId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing auth context' } }, 401);
    }

    const { action, resourceType, resourceId } = c.req.query();
    if (!action) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'action query param required' } }, 400);
    }

    const result = await mgr.checkPermission(
      workspaceId,
      userId,
      action,
      resourceType as Parameters<typeof mgr.checkPermission>[3],
      resourceId,
    );
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to check permission' } }, 500);
    }
    return c.json({ data: { allowed: result.value } });
  });

  return app;
}
