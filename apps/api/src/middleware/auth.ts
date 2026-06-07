import { clerkMiddleware, getAuth } from '@hono/clerk-auth';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';

export { clerkMiddleware };

/**
 * Require a valid Clerk JWT on the request.
 * Returns 401 if the token is missing or invalid.
 */
export const requireAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Valid authentication is required' } },
      401,
    );
  }
  return next();
});

/**
 * Extract workspace ID from the Clerk session and inject it into the request context.
 *
 * Workspace ID is sourced from the Clerk organization ID (orgId). Single-tenant
 * deployments without an org always resolve to the user ID so that legacy single-user
 * setups continue to work without changes.
 *
 * Downstream route handlers read workspaceId via c.get('workspaceId').
 *
 * Returns 401 when no authenticated session is present.
 */
export const injectWorkspace: MiddlewareHandler = createMiddleware(async (c, next) => {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Valid authentication is required' } },
      401,
    );
  }

  // Prefer Clerk org ID for multi-tenant setups; fall back to userId for single-tenant.
  const workspaceId = auth.orgId ?? auth.userId;
  c.set('workspaceId', workspaceId);

  return next();
});

/**
 * Assert that the workspaceId in the request query/body matches the one injected by
 * `injectWorkspace`. Returns 403 if they differ. Use this on routes that receive an
 * explicit workspaceId param (e.g. POST /connectors) to prevent cross-tenant writes.
 *
 * @param requestedId - workspaceId from the request payload or query string
 * @param c           - Hono context (must have workspaceId set by injectWorkspace)
 */
export function assertWorkspaceMatch(
  requestedId: string,
  authenticatedId: string,
): string | null {
  if (requestedId !== authenticatedId) {
    return `Access denied: workspace "${requestedId}" is not accessible with this session`;
  }
  return null;
}

// Augment Hono's ContextVariableMap so downstream handlers are typed.
declare module 'hono' {
  interface ContextVariableMap {
    workspaceId: string;
  }
}
