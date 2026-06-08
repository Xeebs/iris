import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/proactive-context-engine', () => ({
  ProactiveContextEngine: vi.fn().mockImplementation(() => mockSvc),
}));

import { createProactiveContextRoutes } from '../routes/proactive-context.js';

const mockSvc = {
  getAgentProfile: vi.fn(),
  predictContext: vi.fn(),
  getAcceptanceStats: vi.fn(),
  saveSettings: vi.fn(),
  recordFeedback: vi.fn(),
};

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createProactiveContextRoutes>[0];
  const app = new Hono();
  app.route('/proactive', createProactiveContextRoutes(sql));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /proactive/agents/:agentId/profile', () => {
  it('returns 401 without workspace', async () => {
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/profile');
    expect(res.status).toBe(401);
  });

  it('returns 404 when no profile exists', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.getAgentProfile.mockResolvedValue(ok(null));
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/profile', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(404);
  });

  it('returns profile when found', async () => {
    const { ok } = await import('neverthrow');
    const profile = { agentId: 'agent-1', frequentEntityTypes: ['contact'], totalQueries: 50, queryPatterns: {}, learnedAt: '2026-06-08' };
    mockSvc.getAgentProfile.mockResolvedValue(ok(profile));
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/profile', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: typeof profile };
    expect(json.data.agentId).toBe('agent-1');
  });
});

describe('GET /proactive/agents/:agentId/proactive-preview', () => {
  it('returns suggestions', async () => {
    const { ok } = await import('neverthrow');
    const suggestions = [{ id: 's-1', entityTypes: ['contact'], contextHints: ['Load contacts'], score: 0.7 }];
    mockSvc.predictContext.mockResolvedValue(ok(suggestions));
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/proactive-preview', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });
});

describe('GET /proactive/agents/:agentId/acceptance-stats', () => {
  it('returns acceptance stats', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.getAcceptanceStats.mockResolvedValue(ok({ total: 10, accepted: 7, ignored: 2, modified: 1, acceptanceRate: 0.7 }));
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/acceptance-stats', {
      headers: { 'x-workspace-id': 'ws-1' },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { data: { acceptanceRate: number } };
    expect(json.data.acceptanceRate).toBeCloseTo(0.7);
  });
});

describe('POST /proactive/agents/:agentId/proactive-settings', () => {
  it('returns 400 for invalid aggressiveness', async () => {
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/proactive-settings', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ aggressiveness: 'ultra' }),
    });
    expect(res.status).toBe(400);
  });

  it('saves settings successfully', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.saveSettings.mockResolvedValue(ok({ agentId: 'agent-1', aggressiveness: 'medium', enabledEntityTypes: [], updatedAt: '2026-06-08' }));
    const app = makeApp();
    const res = await app.request('/proactive/agents/agent-1/proactive-settings', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ aggressiveness: 'medium', enabledEntityTypes: ['contact'] }),
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /proactive/proactive/feedback', () => {
  it('returns 400 for missing agentId', async () => {
    const app = makeApp();
    const res = await app.request('/proactive/proactive/feedback', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ suggestionId: 's-1', feedback: 'accepted' }),
    });
    expect(res.status).toBe(400);
  });

  it('records feedback successfully', async () => {
    const { ok } = await import('neverthrow');
    mockSvc.recordFeedback.mockResolvedValue(ok(undefined));
    const app = makeApp();
    const res = await app.request('/proactive/proactive/feedback', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws-1', 'content-type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', suggestionId: 's-1', feedback: 'accepted', feedbackScore: 1.0 }),
    });
    expect(res.status).toBe(200);
  });
});
