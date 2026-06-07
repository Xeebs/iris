import { createMiddleware } from 'hono/factory';
import { getAuth } from '@hono/clerk-auth';
import type postgres from 'postgres';

import { logger } from '@iris/core/logger';

const log = logger.child({ middleware: 'workspace-membership' });

type SqlClient = ReturnType<typeof postgres>;

/**
 * Build a middleware that verifies the authenticated user is an active member
 * of the workspace currently in context.
 *
 * @param sql - Postgres client for membership lookups
 * @returns Hono middleware handler
 */
export function requireWorkspaceMember(sql: SqlClient) {
  return createMiddleware(async (c, next) => {
    const userId: string | undefined = getAuth(c)?.userId ?? undefined;
    const workspaceId: string | undefined = c.get('workspaceId') as string | undefined;

    if (!userId || !workspaceId) {
      return c.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Valid authentication is required' } },
        401,
      );
    }

    try {
      const rows = await sql`
        SELECT id, role FROM workspace_members
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${userId}
          AND invite_status = 'active'
        LIMIT 1
      `;

      if (rows.length === 0) {
        return c.json(
          { error: { code: 'FORBIDDEN', message: 'You are not a member of this workspace' } },
          403,
        );
      }

      c.set('memberRole', (rows[0] as { role: string }).role);
      return next();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Membership check failed', { workspaceId, userId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Membership check failed' } }, 500);
    }
  });
}

/**
 * Build a middleware that requires the authenticated user to be an admin
 * of the workspace.
 *
 * @param sql - Postgres client
 * @returns Hono middleware handler
 */
export function requireWorkspaceAdmin(sql: SqlClient) {
  return createMiddleware(async (c, next) => {
    const userId: string | undefined = getAuth(c)?.userId ?? undefined;
    const workspaceId: string | undefined = c.get('workspaceId') as string | undefined;

    if (!userId || !workspaceId) {
      return c.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Valid authentication is required' } },
        401,
      );
    }

    try {
      const rows = await sql`
        SELECT id FROM workspace_members
        WHERE workspace_id = ${workspaceId}
          AND user_id = ${userId}
          AND role = 'admin'
          AND invite_status = 'active'
        LIMIT 1
      `;

      if (rows.length === 0) {
        return c.json(
          { error: { code: 'FORBIDDEN', message: 'Admin role required for this action' } },
          403,
        );
      }

      return next();
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      log.error('Admin check failed', { workspaceId, userId, error: error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Admin check failed' } }, 500);
    }
  });
}
