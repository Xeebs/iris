import { Hono } from 'hono';
import { z } from 'zod';
import { RateLimitService, TIER_LIMITS } from '@iris/semantic-core/rate-limiter';

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const QuotaIncreaseSchema = z.object({
  workspaceId: z.string().uuid(),
  requestedTier: z.enum(['pro', 'enterprise']),
  justification: z.string().min(10),
});

const SetTierSchema = z.object({
  tier: z.enum(['free', 'pro', 'enterprise']),
});

const OverrideSchema = z.object({
  workspaceId: z.string().uuid(),
  endpoint: z.string().min(1),
  overrideLimit: z.number().int().positive(),
  reason: z.string().min(1),
  grantedBy: z.string().min(1),
  expiresAt: z.string().datetime(),
});

/**
 * @param sql - Postgres-compatible tagged template SQL function
 * @returns Hono router for /api/v1/quota-management
 */
export function makeQuotaRouter(sql: SqlFn) {
  const app = new Hono();
  const svc = new RateLimitService(sql);

  // GET /usage — current quota usage for requesting workspace
  app.get('/usage', async (c) => {
    const workspaceId = c.req.header('x-workspace-id');
    if (!workspaceId) return c.json({ error: { code: 'missing_workspace', message: 'X-Workspace-Id header required' } }, 400);
    const result = await svc.getQuotaStatus(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  // GET /tiers — available tier definitions
  app.get('/tiers', (c) => {
    const tiers = Object.entries(TIER_LIMITS).map(([name, limits]) => ({ name, limits }));
    return c.json({ data: tiers });
  });

  // POST /quota-increase-request — submit a quota increase request
  app.post('/quota-increase-request', async (c) => {
    const parsed = QuotaIncreaseSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { workspaceId, requestedTier, justification } = parsed.data;
    try {
      type Row = { id: string };
      const [row] = await sql`
        INSERT INTO quota_increase_requests (id, workspace_id, requested_tier, justification)
        VALUES (gen_random_uuid(), ${workspaceId}, ${requestedTier}, ${justification})
        RETURNING id
      ` as unknown as Row[];
      return c.json({ data: { id: row!.id, status: 'pending', workspaceId, requestedTier } }, 201);
    } catch (e) {
      return c.json({ error: { code: 'db_error', message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // GET /admin/rate-limits — all workspace tier configs
  app.get('/admin/rate-limits', async (c) => {
    try {
      type Row = { workspace_id: string; tier: string; updated_at: Date };
      const rows = await sql`
        SELECT workspace_id, tier, updated_at FROM rate_limit_configs ORDER BY updated_at DESC
      ` as unknown as Row[];
      return c.json({ data: rows.map((r) => ({ workspaceId: r.workspace_id, tier: r.tier, updatedAt: r.updated_at, limits: TIER_LIMITS[r.tier as 'free' | 'pro' | 'enterprise'] })) });
    } catch (e) {
      return c.json({ error: { code: 'db_error', message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // PUT /admin/rate-limits/:workspaceId — set workspace tier
  app.put('/admin/rate-limits/:workspaceId', async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const parsed = SetTierSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const result = await svc.setTier(workspaceId, parsed.data.tier);
    if (result.isErr()) return c.json({ error: { code: 'db_error', message: result.error.message } }, 500);
    return c.json({ data: { workspaceId, tier: parsed.data.tier, limits: TIER_LIMITS[parsed.data.tier] } });
  });

  // POST /admin/quota-overrides — grant temporary limit override
  app.post('/admin/quota-overrides', async (c) => {
    const parsed = OverrideSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: { code: 'validation_error', message: 'Invalid body', details: parsed.error.flatten() } }, 400);
    const { workspaceId, endpoint, overrideLimit, reason, grantedBy, expiresAt } = parsed.data;
    try {
      type Row = { id: string };
      const [row] = await sql`
        INSERT INTO quota_overrides (workspace_id, endpoint, override_limit, reason, granted_by, expires_at)
        VALUES (${workspaceId}, ${endpoint}, ${overrideLimit}, ${reason}, ${grantedBy}, ${expiresAt})
        RETURNING id
      ` as unknown as Row[];
      return c.json({ data: { id: row!.id, workspaceId, endpoint, overrideLimit, expiresAt } }, 201);
    } catch (e) {
      return c.json({ error: { code: 'db_error', message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // GET /admin/quota-increase-requests — pending approval queue
  app.get('/admin/quota-increase-requests', async (c) => {
    const status = c.req.query('status') ?? 'pending';
    try {
      type Row = { id: string; workspace_id: string; requested_tier: string; justification: string; status: string; created_at: Date };
      const rows = await sql`
        SELECT id, workspace_id, requested_tier, justification, status, created_at
        FROM quota_increase_requests WHERE status = ${status}
        ORDER BY created_at DESC LIMIT 50
      ` as unknown as Row[];
      return c.json({ data: rows.map((r) => ({ id: r.id, workspaceId: r.workspace_id, requestedTier: r.requested_tier, justification: r.justification, status: r.status, createdAt: r.created_at })) });
    } catch (e) {
      return c.json({ error: { code: 'db_error', message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  return app;
}
