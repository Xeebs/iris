import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';

import { MultiProviderOptimizer } from '@iris/semantic-core/multi-provider-optimizer';
import { listProviders } from '@iris/semantic-core/provider-registry';

type SqlClient = ReturnType<typeof postgres>;

const saveConfigSchema = z.object({
  providerId: z.enum(['openai', 'anthropic', 'google', 'ollama', 'mistral', 'cohere']),
  priority: z.number().int().min(1).max(100),
  isEnabled: z.boolean(),
});

const estimateCostSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokensEstimate: z.number().int().min(0),
  embeddingTokens: z.number().int().min(0).optional(),
});

/**
 * Routes for multi-LLM provider configuration and cost estimation.
 *
 * @param sql - Postgres client
 * @returns Hono router
 */
export function createProviderRoutes(sql: SqlClient) {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new MultiProviderOptimizer(sql as unknown as any);

  const getWorkspaceId = (c: Context) =>
    (c.get('workspaceId') as string | undefined) ?? c.req.header('x-workspace-id');

  /** GET /providers/registry — list all supported LLM providers */
  app.get('/registry', (c) => {
    return c.json({ data: listProviders() });
  });

  /** GET /providers — list workspace provider configurations */
  app.get('/', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    const result = await svc.listWorkspaceProviders(workspaceId);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: result.value });
  });

  /** PUT /providers/:providerId — save provider config for workspace */
  app.put('/:providerId', async (c) => {
    const workspaceId = getWorkspaceId(c);
    if (!workspaceId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace' } }, 401);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }
    const parsed = saveConfigSchema.safeParse({ ...body as object, providerId: c.req.param('providerId') });
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const result = await svc.saveProviderConfig(workspaceId, parsed.data.providerId, parsed.data.priority, parsed.data.isEnabled);
    if (result.isErr()) return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    return c.json({ data: { success: true } });
  });

  /** POST /providers/estimate-cost — compare costs across all providers */
  app.post('/estimate-cost', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON' } }, 400); }
    const parsed = estimateCostSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
    const estimates = svc.estimateCosts(
      parsed.data.inputTokens,
      parsed.data.outputTokensEstimate,
      parsed.data.embeddingTokens ?? 0,
    );
    return c.json({ data: estimates });
  });

  return app;
}
