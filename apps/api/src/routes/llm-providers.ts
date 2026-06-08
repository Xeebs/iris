import { Hono } from 'hono';
import { z } from 'zod';

import { LlmRouter } from '@iris/semantic-core/llm-router';
import { logger } from '@iris/core/logger';

const log = logger.child({ route: 'llm-providers' });

type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

const registerProviderSchema = z.object({
  providerId: z.enum(['openai', 'anthropic', 'google', 'ollama']),
  modelId: z.string().min(1),
  apiKey: z.string().min(1),
  costPer1mTokens: z.number().min(0).default(0),
  defaultForUseCase: z.enum(['completion', 'embedding']).optional(),
  endpoint: z.string().url().optional(),
});

const testCompletionSchema = z.object({
  prompt: z.string().min(1).max(500).default('Say hello in one word.'),
});

/**
 * Factory for LLM provider configuration routes.
 *
 * @param sql - Postgres client
 * @returns Hono router for llm-providers endpoints
 */
export function createLlmProviderRoutes(sql: SqlFn): Hono {
  const app = new Hono();
  const router = new LlmRouter(sql);

  /** GET /api/v1/llm-providers — list configured providers for workspace */
  app.get('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const result = await router.listProviders(workspaceId);
    if (result.isErr()) {
      log.error('Failed to list providers', { workspaceId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: result.value });
  });

  /** POST /api/v1/llm-providers — register a new provider */
  app.post('/', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = registerProviderSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid provider config', details: parsed.error.flatten() } }, 400);
    }

    const d = parsed.data;
    const result = await router.registerProvider({
      workspaceId,
      providerId: d.providerId,
      modelId: d.modelId,
      apiKeyEncrypted: d.apiKey,
      costPer1mTokens: d.costPer1mTokens,
      defaultForUseCase: d.defaultForUseCase ?? null,
      endpoint: d.endpoint ?? null,
    });

    if (result.isErr()) {
      log.error('Failed to register provider', { workspaceId, providerId: d.providerId, error: result.error.message });
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    log.info('Provider registered', { workspaceId, providerId: d.providerId });
    return c.json({ data: { configId: result.value } }, 201);
  });

  /** DELETE /api/v1/llm-providers/:configId — deregister a provider */
  app.delete('/:configId', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const { configId } = c.req.param();
    const result = await router.deregisterProvider(configId, workspaceId);
    if (result.isErr()) {
      return c.json({ error: { code: 'INTERNAL_ERROR', message: result.error.message } }, 500);
    }

    return c.json({ data: { deleted: true } });
  });

  /** POST /api/v1/llm-providers/:configId/test — verify provider connectivity */
  app.post('/:configId/test', async (c) => {
    const workspaceId = c.get('workspaceId') as string | undefined;
    if (!workspaceId) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing workspace context' } }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = testCompletionSchema.safeParse(body);
    const prompt = parsed.success ? parsed.data.prompt : 'Say hello in one word.';

    router.invalidateCache(workspaceId);
    const startMs = Date.now();
    const result = await router.complete([{ role: 'user', content: prompt }], workspaceId);
    const latencyMs = Date.now() - startMs;

    if (result.isErr()) {
      log.warn('Provider test failed', { workspaceId, error: result.error.message });
      return c.json({ data: { healthy: false, latencyMs: null, error: result.error.message } });
    }

    return c.json({ data: { healthy: true, latencyMs, response: result.value.content.slice(0, 100) } });
  });

  return app;
}
