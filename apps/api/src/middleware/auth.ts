import { clerkMiddleware, getAuth } from '@hono/clerk-auth';
import type { MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import type postgres from 'postgres';

import { ApiKeyManager } from '@iris/semantic-core';
import { logger } from '@iris/core/logger';

export { clerkMiddleware };

const log = logger.child({ middleware: 'auth' });

/**
 * Demo-mode API-key authentication (DEMO_MODE=true only). Accepts the
 * `Authorization: Bearer iris_...` MCP API keys issued by /demo/bootstrap,
 * validates them against mcp_api_keys, and injects the key's workspaceId.
 * Mount before requireAuth; inactive (pass-through) outside demo mode.
 *
 * @param sql - Postgres client for key validation
 * @returns Hono middleware
 */
export function demoApiKeyAuth(sql: ReturnType<typeof postgres>): MiddlewareHandler {
  const keyManager = new ApiKeyManager(sql);
  return createMiddleware(async (c, next) => {
    if (process.env['DEMO_MODE'] !== 'true') return next();

    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer iris_')) return next();

    const result = await keyManager.validateKey(header.slice('Bearer '.length));
    if (result.isOk()) {
      c.set('workspaceId', result.value.workspaceId);
      c.set('demoAuthenticated', true);
      log.debug('Demo API-key auth accepted', { workspaceId: result.value.workspaceId });
    }
    return next();
  });
}

/**
 * Require a valid Clerk JWT on the request.
 * Returns 401 if the token is missing or invalid.
 * Requests already authenticated by demoApiKeyAuth (DEMO_MODE) pass through.
 */
export const requireAuth: MiddlewareHandler = createMiddleware(async (c, next) => {
  if (c.get('demoAuthenticated') === true) {
    return next();
  }
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
    demoAuthenticated: boolean;
  }
}
