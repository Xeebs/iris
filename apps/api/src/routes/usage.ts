import { Hono } from 'hono';
import { z } from 'zod';
import { RateLimitService, TIER_LIMITS, type TierName } from '@iris/semantic-core/rate-limiter';
import { logger } from '@iris/core/logger';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const log = logger.child({ route: 'usage' });

const setTierSchema = z.object({
  tier: z.enum(['free', 'pro', 'enterprise']),
});

/**
 * @param sql - Tagged template SQL function
 * @returns Hono router for usage/quota endpoints
 */
export function createUsageRoutes(sql: SqlFn) {
  const app = new Hono();
  const rateLimiter = new RateLimitService(sql);

  // GET /usage — current quota usage for workspace
  app.get('/usage', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const result = await rateLimiter.getQuotaStatus(workspaceId);
    if (result.isErr()) {
      log.error('Failed to get quota status', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'QUOTA_FAILED', message: result.error.message } }, 500);
    }
    return c.json({ data: result.value });
  });

  // GET /limits — tier limits reference table
  app.get('/limits', (c) => {
    return c.json({ data: TIER_LIMITS });
  });

  // PUT /limits/tier — update workspace tier (admin only)
  app.put('/limits/tier', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => null) as unknown;
    const parsed = setTierSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid body' } }, 400);
    }
    const result = await rateLimiter.setTier(workspaceId, parsed.data.tier as TierName);
    if (result.isErr()) {
      return c.json({ error: { code: 'TIER_SET_FAILED', message: result.error.message } }, 500);
    }
    log.info('Workspace tier set', { workspaceId, tier: parsed.data.tier });
    return c.json({ data: { workspaceId, tier: parsed.data.tier } });
  });

  // POST /limits/increase-request — request quota increase (placeholder: records request)
  app.post('/limits/increase-request', async (c) => {
    const workspaceId = (c.get('workspaceId') as string | undefined) ?? 'default';
    const body = await c.req.json().catch(() => ({})) as { reason?: string };
    log.info('Quota increase requested', { workspaceId, reason: body.reason ?? 'not provided' });
    return c.json({ data: { submitted: true, message: 'Your quota increase request has been submitted.' } }, 201);
  });

  return app;
}
