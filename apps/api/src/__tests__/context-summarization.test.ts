import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/context-summarizer', () => ({
  classifyQueryIntent: vi.fn((q: string) => q.includes('analyz') ? 'analytical' : 'operational'),
  rankContextByTaskRelevance: vi.fn((entities: unknown[]) =>
    entities.map((e, i) => ({ ...(e as object), relevanceScore: 1 - i * 0.1, relevanceReason: 'mock' }))
  ),
  generateTaskSpecificSummary: vi.fn(() => ({
    content: '• Alice Smith (contact, email: alice@co.com)\n• Q4 Deal (deal, value: 75000)',
    format: 'bullet_list',
    originalTokens: 800,
    summaryTokens: 40,
    compressionRatio: 0.95,
    intent: 'operational',
    provider: 'anthropic',
  })),
  optimizeSummaryStructure: vi.fn((content: string) => content.trim()),
  recordSummarizationMetrics: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  getSummarizationMetrics: vi.fn(async () => ({
    isOk: () => true,
    isErr: () => false,
    value: {
      workspaceId: 'ws1',
      totalSummaries: 250,
      avgCompressionRatio: 0.61,
      avgSatisfactionScore: 0.87,
      byIntent: {
        analytical: { count: 80, avgCompression: 0.65 },
        operational: { count: 120, avgCompression: 0.58 },
        reporting: { count: 40, avgCompression: 0.70 },
        synthesis: { count: 10, avgCompression: 0.62 },
      },
    },
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/context-summarization';

function buildApp() {
  const app = new Hono();
  app.route('/context-summarization', routeModule);
  return app;
}

const SAMPLE_ENTITIES = [
  { id: 'e1', type: 'contact', label: 'Alice Smith', attributes: { email: 'alice@co.com', company: 'Acme' } },
  { id: 'e2', type: 'deal', label: 'Q4 Deal', attributes: { value: 75000, stage: 'closing' } },
];

describe('POST /context-summarization/summarize', () => {
  it('returns a summary for given entities and query', async () => {
    const res = await buildApp().request('/context-summarization/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show active contacts', entities: SAMPLE_ENTITIES }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { content: string; compressionRatio: number } };
    expect(body.data.content).toBeTruthy();
    expect(body.data.compressionRatio).toBe(0.95);
  });

  it('uses specified provider', async () => {
    const res = await buildApp().request('/context-summarization/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'analyze trends', entities: SAMPLE_ENTITIES, provider: 'gemini' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing query', async () => {
    const res = await buildApp().request('/context-summarization/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entities: SAMPLE_ENTITIES }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty entities', async () => {
    const res = await buildApp().request('/context-summarization/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show contacts', entities: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('respects targetTokens parameter', async () => {
    const res = await buildApp().request('/context-summarization/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'show contacts', entities: SAMPLE_ENTITIES, targetTokens: 200 }),
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /context-summarization/metrics', () => {
  it('returns compression metrics', async () => {
    const res = await buildApp().request('/context-summarization/metrics', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { totalSummaries: number; avgCompressionRatio: number } };
    expect(body.data.totalSummaries).toBe(250);
    expect(body.data.avgCompressionRatio).toBe(0.61);
  });
});

describe('POST /context-summarization/metrics/track', () => {
  it('records metrics and returns 201', async () => {
    const res = await buildApp().request('/context-summarization/metrics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ originalTokenCount: 2000, summaryTokenCount: 780, queryIntent: 'analytical', satisfactionScore: 0.92 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { recorded: boolean } };
    expect(body.data.recorded).toBe(true);
  });

  it('returns 400 for invalid queryIntent', async () => {
    const res = await buildApp().request('/context-summarization/metrics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalTokenCount: 1000, summaryTokenCount: 400, queryIntent: 'invalid-intent' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /context-summarization/classify-intent', () => {
  it('returns classified intent', async () => {
    const res = await buildApp().request('/context-summarization/classify-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'analyze trends in deal pipeline' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { intent: string } };
    expect(body.data.intent).toBe('analytical');
  });

  it('returns 400 for missing query', async () => {
    const res = await buildApp().request('/context-summarization/classify-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
