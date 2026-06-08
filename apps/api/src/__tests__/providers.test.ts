import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/multi-provider-optimizer', () => ({
  MultiProviderOptimizer: vi.fn().mockImplementation(() => mockInstance),
}));

vi.mock('@iris/semantic-core/provider-registry', () => ({
  listProviders: vi.fn().mockReturnValue([
    { id: 'openai', name: 'OpenAI', contextWindowTokens: 128000, inputCostPer1kTokens: 0.005 },
    { id: 'anthropic', name: 'Anthropic Claude', contextWindowTokens: 200000, inputCostPer1kTokens: 0.003 },
  ]),
}));

import { createProviderRoutes } from '../routes/providers.js';
import { MultiProviderOptimizer } from '@iris/semantic-core/multi-provider-optimizer';

const mockInstance = {
  listWorkspaceProviders: vi.fn(),
  saveProviderConfig: vi.fn(),
  estimateCosts: vi.fn(),
  selectProvider: vi.fn(),
};

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createProviderRoutes>[0];
  const app = new Hono();
  app.route('/providers', createProviderRoutes(sql));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /providers/registry', () => {
  it('returns all registered providers without auth', async () => {
    const app = makeApp();
    const res = await app.request('/providers/registry');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(2);
  });
});

describe('GET /providers', () => {
  it('returns 401 without workspace header', async () => {
    const app = makeApp();
    const res = await app.request('/providers');
    expect(res.status).toBe(401);
  });

  it('returns workspace provider configs', async () => {
    const { ok } = await import('neverthrow');
    const configs = [{ workspaceId: 'ws-1', providerId: 'openai', priority: 1, isEnabled: true }];
    mockInstance.listWorkspaceProviders.mockResolvedValue(ok(configs));
    const app = makeApp();
    const res = await app.request('/providers', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });

  it('returns 500 on service error', async () => {
    const { err } = await import('neverthrow');
    mockInstance.listWorkspaceProviders.mockResolvedValue(err(new Error('DB fail')));
    const app = makeApp();
    const res = await app.request('/providers', { headers: { 'x-workspace-id': 'ws-1' } });
    expect(res.status).toBe(500);
  });
});

describe('PUT /providers/:providerId', () => {
  it('returns 400 for invalid provider ID', async () => {
    const app = makeApp();
    const res = await app.request('/providers/not-a-provider', {
      method: 'PUT',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ priority: 1, isEnabled: true }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 on successful save', async () => {
    const { ok } = await import('neverthrow');
    mockInstance.saveProviderConfig.mockResolvedValue(ok(undefined));
    const app = makeApp();
    const res = await app.request('/providers/anthropic', {
      method: 'PUT',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ priority: 1, isEnabled: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { success: boolean } };
    expect(json.data.success).toBe(true);
  });
});

describe('POST /providers/estimate-cost', () => {
  it('returns 400 for missing required fields', async () => {
    const app = makeApp();
    const res = await app.request('/providers/estimate-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputTokens: 1000 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns cost estimates for all providers', async () => {
    const estimates = [
      { providerId: 'ollama', totalCostUsd: 0 },
      { providerId: 'openai', totalCostUsd: 0.01 },
    ];
    mockInstance.estimateCosts.mockReturnValue(estimates);
    const app = makeApp();
    const res = await app.request('/providers/estimate-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputTokens: 1000, outputTokensEstimate: 500 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(2);
  });
});
