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
