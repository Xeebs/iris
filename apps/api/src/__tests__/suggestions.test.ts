import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { ok, err } from 'neverthrow';

const mockService = {
  getRecentSuggestions: vi.fn(),
  saveSuggestions: vi.fn(),
  logSuggestions: vi.fn(),
};

const mockGenerateSuggestions = vi.fn().mockReturnValue({ suggestions: [{ query: 'show deals', score: 0.9 }] });

vi.mock('@iris/semantic-core/proactive-suggester', () => ({
  generateSuggestions: mockGenerateSuggestions,
  ProactiveSuggesterService: vi.fn(() => mockService),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createSuggestionsRoutes } = await import('../routes/suggestions.js');
  return createSuggestionsRoutes;
}

const SAMPLE_SUGGESTIONS = [
  { id: 'sug-1', query: 'Show deals closing this month', score: 0.9, category: 'deals', createdAt: new Date().toISOString() },
];

describe('suggestions routes', () => {
  let createSuggestionsRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createSuggestionsRoutes = await importRoutes();
  });

  function buildApp() {
    const app = new Hono();
    app.route('/context-suggestions', createSuggestionsRoutes({} as never));
    return app;
  }

  describe('GET /', () => {
    it('returns 200 with saved suggestions', async () => {
      mockService.getRecentSuggestions.mockResolvedValue(ok(SAMPLE_SUGGESTIONS));
      const res = await buildApp().request('/context-suggestions?workspaceId=ws-1');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_SUGGESTIONS };
      expect(body.data).toHaveLength(1);
    });

    it('returns 400 when workspaceId missing', async () => {
      const res = await buildApp().request('/context-suggestions');
      expect(res.status).toBe(400);
    });

    it('returns 500 on service error', async () => {
      mockService.getRecentSuggestions.mockResolvedValue(err(new Error('db error')));
      const res = await buildApp().request('/context-suggestions?workspaceId=ws-1');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /', () => {
    it('generates suggestions and returns 200', async () => {
      mockService.logSuggestions = vi.fn().mockResolvedValue(ok(undefined));
      const res = await buildApp().request('/context-suggestions?workspaceId=ws-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'user-1',
          recentActivity: [{ query: 'show deals', entityType: 'deal' }],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { suggestions: unknown[] } };
      expect(body.data.suggestions).toHaveLength(1);
    });

    it('returns 400 when workspaceId missing', async () => {
      const res = await buildApp().request('/context-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'u1' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
