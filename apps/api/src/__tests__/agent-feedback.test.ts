import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/agent-feedback-engine', () => ({
  recordUserFeedback: vi.fn(async () => ({ isOk: () => true, isErr: () => false, value: 'fb-1' })),
  getAgentInsights: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: {
      agentId: 'agent-1',
      workspaceId: 'ws1',
      totalUsages: 15,
      avgRating: 4.1,
      mostUsefulEntityTypes: ['contact', 'deal'],
      leastUsefulEntityTypes: ['metric'],
      feedbackCount: 10,
    },
  })),
  getRelevanceAdjustments: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: [
      { entityType: 'contact', workspaceId: 'ws1', positiveFeedbackCount: 8, negativeFeedbackCount: 2, weightAdjustment: 0.3, lastUpdatedAt: new Date() },
    ],
  })),
  updateRelevanceWeights: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  suggestContextExpansion: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: { agentId: 'agent-1', workspaceId: 'ws1', suggestedEntityTypes: ['task', 'activity'], reasoning: '5 positive signals', confidenceScore: 0.7 },
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/agent-feedback';

function buildApp() {
  const app = new Hono();
  app.route('/agents', routeModule);
  return app;
}

describe('POST /agents/:agentId/feedback', () => {
  it('records feedback and returns 201 with feedbackId', async () => {
    const res = await buildApp().request('/agents/agent-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ usageId: 'u1', rating: 4, feedbackSource: 'explicit' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { feedbackId: string; recorded: boolean } };
    expect(body.data.feedbackId).toBe('fb-1');
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 for rating out of range', async () => {
    const res = await buildApp().request('/agents/agent-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ usageId: 'u1', rating: 6 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing usageId', async () => {
    const res = await buildApp().request('/agents/agent-1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ rating: 3 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /agents/:agentId/insights', () => {
  it('returns insights with expansion suggestion', async () => {
    const res = await buildApp().request('/agents/agent-1/insights', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { totalUsages: number; avgRating: number; contextExpansionSuggestion: { suggestedEntityTypes: string[] } } };
    expect(body.data.totalUsages).toBe(15);
    expect(body.data.avgRating).toBeCloseTo(4.1);
    expect(body.data.contextExpansionSuggestion.suggestedEntityTypes).toContain('task');
  });
});

describe('GET /agents/entities/:entityType/feedback-score', () => {
  it('returns weight adjustment for known entity type', async () => {
    const res = await buildApp().request('/agents/entities/contact/feedback-score', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { weightAdjustment: number } };
    expect(body.data.weightAdjustment).toBeCloseTo(0.3);
  });

  it('returns zero score for unknown entity type', async () => {
    const res = await buildApp().request('/agents/entities/unknown-type/feedback-score', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { weightAdjustment: number } };
    expect(body.data.weightAdjustment).toBe(0);
  });
});

describe('GET /agents/relevance-adjustments', () => {
  it('returns all adjustments with count', async () => {
    const res = await buildApp().request('/agents/relevance-adjustments', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ entityType: string }>; meta: { count: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.count).toBe(1);
    expect(body.data[0]!.entityType).toBe('contact');
  });
});
