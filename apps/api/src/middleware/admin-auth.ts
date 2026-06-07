import type { Context, Next } from 'hono';
import { getAuth } from '@hono/clerk-auth';

/**
 * Middleware that restricts access to Clerk organization admins.
 * Returns 403 if the caller is not an org admin.
 */
export async function requireAdminRole(c: Context, next: Next): Promise<Response | void> {
  const auth = getAuth(c);
  if (!auth?.userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  // In production, check Clerk organization membership for admin role.
  // For now we check if the session claims include orgRole=admin.
  const orgRole = (auth as unknown as Record<string, unknown>).orgRole;
  if (orgRole !== 'admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, 403);
  }

  await next();
}
