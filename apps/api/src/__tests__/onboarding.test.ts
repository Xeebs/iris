import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(() => ({ userId: 'user-123' })),
  clerkMiddleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

import { createOnboardingRoutes } from '../routes/onboarding.js';

const mockSqlFn = Object.assign(
  vi.fn((..._args: unknown[]) => Promise.resolve([])),
  { array: vi.fn((arr: unknown[]) => arr) },
) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-test') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createOnboardingRoutes(mockSqlFn));
  return app;
}

describe('onboarding routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
    (mockSqlFn as unknown as { array: ReturnType<typeof vi.fn> }).array = vi.fn((arr: unknown[]) => arr);
  });

  describe('GET /status', () => {
    it('returns started:false when no onboarding exists', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/status');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { started: boolean; totalSteps: number } };
      expect(body.data.started).toBe(false);
      expect(body.data.totalSteps).toBe(7);
    });

    it('returns onboarding state when session exists', async () => {
      mockSqlFn.mockResolvedValueOnce([{
        id: 'ob-1',
        workspace_id: 'ws-test',
        status: 'in_progress',
        current_step: 3,
        completed_steps: [1, 2],
        industry: 'finance',
        company_size: '11-50',
        use_case: 'sales analytics',
        selected_connectors: ['hubspot'],
        first_sync_triggered: false,
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }]);
      const app = makeApp();

      const res = await app.request('/status');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { started: boolean; currentStep: number; industry: string } };
      expect(body.data.started).toBe(true);
      expect(body.data.currentStep).toBe(3);
      expect(body.data.industry).toBe('finance');
    });
  });

  describe('POST /start', () => {
    it('initializes onboarding and returns step 1', async () => {
      mockSqlFn.mockResolvedValueOnce([{
        id: 'ob-1',
        workspace_id: 'ws-test',
        status: 'in_progress',
        current_step: 1,
        completed_steps: [],
        industry: null,
        company_size: null,
        use_case: null,
        selected_connectors: [],
        first_sync_triggered: false,
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }]);
      const app = makeApp();

      const res = await app.request('/start', { method: 'POST' });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { currentStep: number; status: string } };
      expect(body.data.currentStep).toBe(1);
      expect(body.data.status).toBe('in_progress');
    });
  });

  describe('PUT /step', () => {
    it('advances to next step and stores industry info', async () => {
      mockSqlFn.mockResolvedValueOnce([{
        id: 'ob-1',
        workspace_id: 'ws-test',
        status: 'in_progress',
        current_step: 2,
        completed_steps: [1],
        industry: 'finance',
        company_size: '11-50',
        use_case: 'revenue tracking',
        selected_connectors: [],
        first_sync_triggered: false,
        completed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      }]);
      const app = makeApp();

      const res = await app.request('/step', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 2,
          industry: 'finance',
          companySize: '11-50',
          useCase: 'revenue tracking',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { currentStep: number; industry: string } };
      expect(body.data.currentStep).toBe(2);
      expect(body.data.industry).toBe('finance');
    });

    it('marks completed when reaching final step 7', async () => {
      mockSqlFn.mockResolvedValueOnce([{
        id: 'ob-1',
        workspace_id: 'ws-test',
        status: 'completed',
        current_step: 7,
        completed_steps: [1, 2, 3, 4, 5, 6],
        industry: 'sales',
        company_size: '51-200',
        use_case: 'pipeline tracking',
        selected_connectors: ['hubspot', 'salesforce'],
        first_sync_triggered: true,
        completed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      }]);
      const app = makeApp();

      const res = await app.request('/step', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 7 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string; completedAt: string | null } };
      expect(body.data.status).toBe('completed');
      expect(body.data.completedAt).not.toBeNull();
    });

    it('returns 400 for invalid step number', async () => {
      const app = makeApp();

      const res = await app.request('/step', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 10 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when no active onboarding exists', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/step', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 2 }),
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when body is missing', async () => {
      const app = makeApp();
      const res = await app.request('/step', { method: 'PUT' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /skip', () => {
    it('marks onboarding as skipped', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/skip', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('skipped');
    });
  });

  describe('GET /glossary-templates', () => {
    it('returns all industry templates when no filter provided', async () => {
      const app = makeApp();

      const res = await app.request('/glossary-templates');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { industries: string[] } };
      expect(body.data.industries).toContain('finance');
      expect(body.data.industries).toContain('sales');
    });

    it('returns specific industry terms when filtered', async () => {
      const app = makeApp();

      const res = await app.request('/glossary-templates?industry=finance');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { industry: string; terms: Array<{ term: string }> } };
      expect(body.data.industry).toBe('finance');
      expect(body.data.terms.length).toBeGreaterThan(0);
      expect(body.data.terms[0]).toHaveProperty('term');
      expect(body.data.terms[0]).toHaveProperty('definition');
    });

    it('returns empty terms for unknown industry', async () => {
      const app = makeApp();

      const res = await app.request('/glossary-templates?industry=aerospace');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { terms: unknown[] } };
      expect(body.data.terms).toHaveLength(0);
    });
  });
});
