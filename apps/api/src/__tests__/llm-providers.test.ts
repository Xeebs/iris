import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createLlmProviderRoutes } from '../routes/llm-providers.js';
import { ok, err } from 'neverthrow';

vi.mock('@iris/semantic-core/llm-router', () => ({
  LlmRouter: vi.fn().mockImplementation(() => ({
    listProviders: vi.fn(),
    registerProvider: vi.fn(),
    deregisterProvider: vi.fn(),
    complete: vi.fn(),
    invalidateCache: vi.fn(),
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import { LlmRouter } from '@iris/semantic-core/llm-router';

function buildApp() {
  const sqlMock = vi.fn().mockResolvedValue([]) as unknown as Parameters<typeof createLlmProviderRoutes>[0];
  const router = createLlmProviderRoutes(sqlMock);

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/api/v1/llm-providers', router);

  const instance = (LlmRouter as ReturnType<typeof vi.fn>).mock.results.at(-1)?.value as Record<string, ReturnType<typeof vi.fn>>;
  return { app, llmRouter: instance };
}

describe('GET /api/v1/llm-providers', () => {
  let app: Hono;
  let llmRouter: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, llmRouter } = buildApp());
  });

  it('returns 200 with provider list', async () => {
    llmRouter['listProviders'].mockResolvedValueOnce(ok([
      { configId: 'c1', workspaceId: 'ws-test', providerId: 'openai', modelId: 'gpt-4o', costPer1mTokens: 5, defaultForUseCase: 'completion', endpoint: null, createdAt: new Date() },
    ]));
    const res = await app.request('/api/v1/llm-providers');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('returns 500 on failure', async () => {
    llmRouter['listProviders'].mockResolvedValueOnce(err(new Error('DB down')));
    const res = await app.request('/api/v1/llm-providers');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/llm-providers', () => {
  let app: Hono;
  let llmRouter: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, llmRouter } = buildApp());
  });

  it('registers provider and returns 201 with configId', async () => {
    llmRouter['registerProvider'].mockResolvedValueOnce(ok('cfg-new'));
    const res = await app.request('/api/v1/llm-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'anthropic', modelId: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test', costPer1mTokens: 3,
        defaultForUseCase: 'completion',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { configId: string } };
    expect(body.data.configId).toBe('cfg-new');
  });

  it('returns 400 for invalid provider ID', async () => {
    const res = await app.request('/api/v1/llm-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'invalid-llm', modelId: 'test', apiKey: 'key' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when modelId missing', async () => {
    const res = await app.request('/api/v1/llm-providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'openai', apiKey: 'key' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/llm-providers/:configId', () => {
  let app: Hono;
  let llmRouter: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, llmRouter } = buildApp());
  });

  it('returns 200 on successful delete', async () => {
    llmRouter['deregisterProvider'].mockResolvedValueOnce(ok(undefined));
    const res = await app.request('/api/v1/llm-providers/cfg-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('returns 500 on failure', async () => {
    llmRouter['deregisterProvider'].mockResolvedValueOnce(err(new Error('not found')));
    const res = await app.request('/api/v1/llm-providers/cfg-x', { method: 'DELETE' });
    expect(res.status).toBe(500);
  });
});

describe('POST /api/v1/llm-providers/:configId/test', () => {
  let app: Hono;
  let llmRouter: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ app, llmRouter } = buildApp());
  });

  it('returns healthy:true when completion succeeds', async () => {
    llmRouter['complete'].mockResolvedValueOnce(ok({ content: 'Hello!', inputTokens: 5, outputTokens: 1, modelId: 'gpt-4o', providerId: 'openai' }));
    const res = await app.request('/api/v1/llm-providers/cfg-1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { healthy: boolean } };
    expect(body.data.healthy).toBe(true);
  });

  it('returns healthy:false when completion fails', async () => {
    llmRouter['complete'].mockResolvedValueOnce(err(new Error('API key invalid')));
    const res = await app.request('/api/v1/llm-providers/cfg-1/test', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { healthy: boolean; error: string } };
    expect(body.data.healthy).toBe(false);
    expect(body.data.error).toContain('API key invalid');
  });
});
