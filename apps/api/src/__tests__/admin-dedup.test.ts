import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mockMatcher = {
  analyze: vi.fn(),
  merge: vi.fn(),
};

const mockDeduplicator = {
  analyzeWorkspace: vi.fn(),
  mergeEntities: vi.fn(),
  defineDeduplicationRules: vi.fn(),
  getRules: vi.fn(),
};

vi.mock('@iris/semantic-core', () => ({
  EntityDuplicateMatcher: vi.fn(() => mockMatcher),
  VectorStore: vi.fn(() => ({})),
}));

vi.mock('@iris/semantic-core/entity-deduplicator', () => ({
  EntityDeduplicator: vi.fn(() => mockDeduplicator),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));

async function importRoutes() {
  const { createAdminDedupRoutes } = await import('../routes/admin-dedup.js');
  return createAdminDedupRoutes;
}

const SAMPLE_ANALYSIS = {
  workspaceId: 'ws-1', entityType: 'contact',
  duplicatePairs: [{ entityA: 'e1', entityB: 'e2', score: 0.95, signals: {} }],
  analyzedAt: new Date().toISOString(),
};

describe('admin-dedup routes', () => {
  let createAdminDedupRoutes: Awaited<ReturnType<typeof importRoutes>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    createAdminDedupRoutes = await importRoutes();
  });

  function buildApp(workspaceId: string | null = 'ws-1') {
    const app = new Hono();
    app.use('*', async (c, next) => {
      if (workspaceId) c.set('workspaceId', workspaceId);
      await next();
    });
    app.route('/admin/dedup', createAdminDedupRoutes({} as never, {} as never));
    return app;
  }

  function withWorkspace(method: string, path: string, body?: unknown) {
    return new Request(`http://localhost${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws-1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  describe('POST /analyze', () => {
    it('returns 200 with dedup analysis', async () => {
      mockMatcher.analyze.mockResolvedValue({ isOk: () => true, isErr: () => false, value: SAMPLE_ANALYSIS });
      const res = await buildApp().fetch(withWorkspace('POST', '/admin/dedup/analyze', {}));
      expect(res.status).toBe(200);
      const body = await res.json() as { data: typeof SAMPLE_ANALYSIS };
      expect(body.data.duplicatePairs).toHaveLength(1);
    });

    it('returns 500 on service error', async () => {
      mockMatcher.analyze.mockResolvedValue({ isOk: () => false, isErr: () => true, error: new Error('fail') });
      const res = await buildApp().fetch(withWorkspace('POST', '/admin/dedup/analyze', {}));
      expect(res.status).toBe(500);
    });
  });

  describe('POST /merge/:canonicalId/:duplicateId', () => {
    it('merges entities and returns 201', async () => {
      mockMatcher.merge.mockResolvedValue({ isOk: () => true, isErr: () => false, value: { mergedId: 'e1' } });
      const res = await buildApp().fetch(withWorkspace('POST', '/admin/dedup/merge/e1/e2', {
        mergedBy: 'admin',
        signals: { nameSimilarity: 0.9, emailDomainMatch: true, embeddingSimilarity: 0.95, compositeScore: 0.93 },
      }));
      expect(res.status).toBe(201);
    });

    it('returns 400 when signals missing', async () => {
      const res = await buildApp().fetch(withWorkspace('POST', '/admin/dedup/merge/e1/e2', { mergedBy: 'admin' }));
      expect(res.status).toBe(400);
    });
  });

  describe('POST /rules', () => {
    it('defines dedup rules and returns 201', async () => {
      mockDeduplicator.defineDeduplicationRules.mockResolvedValue(['rule-1']);
      const res = await buildApp().fetch(withWorkspace('POST', '/admin/dedup/rules', {
        workspaceId: 'ws-1',
        entityType: 'contact',
        rules: [{ name: 'email-match', condition: { type: 'exact', field: 'email' } }],
      }));
      expect(res.status).toBe(201);
    });

    it('returns 400 when rules array is empty', async () => {
      const res = await buildApp().fetch(withWorkspace('POST', '/admin/dedup/rules', {
        workspaceId: 'ws-1', entityType: 'contact', rules: [],
      }));
      expect(res.status).toBe(400);
    });
  });
});
