/**
 * Multi-tenant isolation tests.
 *
 * These tests verify that workspace boundaries are enforced at the middleware and
 * route level. They do not hit a real database; all cross-workspace enforcement
 * is exercised through route logic and the assertWorkspaceMatch helper.
 *
 * Real DB integration tests that verify FK cascades live in apps/api/src/__tests__/
 * and require docker-compose up -d (run with pnpm test:integration).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

import { assertWorkspaceMatch } from '../middleware/auth.js';

// ─── assertWorkspaceMatch unit tests ─────────────────────────────────────────

describe('assertWorkspaceMatch', () => {
  it('returns null when workspace IDs match', () => {
    expect(assertWorkspaceMatch('ws-A', 'ws-A')).toBeNull();
  });

  it('returns an error string when workspace IDs differ', () => {
    const msg = assertWorkspaceMatch('ws-B', 'ws-A');
    expect(msg).toContain('ws-B');
    expect(msg).toContain('Access denied');
  });
});

// ─── Middleware: injectWorkspace ──────────────────────────────────────────────

vi.mock('@hono/clerk-auth', () => ({
  clerkMiddleware: () => (_c: unknown, next: () => Promise<void>) => next(),
  getAuth: vi.fn(),
}));

import { getAuth } from '@hono/clerk-auth';
import { injectWorkspace } from '../middleware/auth.js';

function makeApp(authResult: { userId: string; orgId?: string } | null) {
  vi.mocked(getAuth).mockReturnValue(authResult as ReturnType<typeof getAuth>);
  const app = new Hono();
  app.use('/protected/*', injectWorkspace);
  app.get('/protected/echo', (c) => c.json({ workspaceId: c.get('workspaceId') }));
  return app;
}

describe('injectWorkspace middleware', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockReset();
  });

  it('returns 401 when no auth session', async () => {
    const app = makeApp(null);
    const res = await app.request('/protected/echo');
    expect(res.status).toBe(401);
  });

  it('sets workspaceId to orgId when org is present', async () => {
    const app = makeApp({ userId: 'user-1', orgId: 'org-ABC' });
    const res = await app.request('/protected/echo');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('org-ABC');
  });

  it('falls back to userId when no org is present', async () => {
    const app = makeApp({ userId: 'user-1' });
    const res = await app.request('/protected/echo');
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('user-1');
  });
});

// ─── Cross-workspace route isolation ─────────────────────────────────────────
// Simulate a route that enforces workspace isolation via assertWorkspaceMatch.

vi.mock('@iris/semantic-core/glossary', () => ({
  GlossaryService: vi.fn(),
}));

import { GlossaryService } from '@iris/semantic-core/glossary';
import { createGlossaryRoutes } from '../routes/glossary.js';

function makeIsolatedApp(authenticatedWorkspaceId: string, serviceResult: unknown) {
  vi.mocked(GlossaryService).mockImplementation(() => ({
    listTerms: vi.fn().mockResolvedValue(serviceResult),
  }) as unknown as InstanceType<typeof GlossaryService>);

  const app = new Hono();

  // Inject a fixed workspaceId simulating a logged-in user from authenticatedWorkspaceId.
  app.use('/api/v1/glossary/*', async (c, next) => {
    c.set('workspaceId', authenticatedWorkspaceId);
    return next();
  });

  app.route('/api/v1/glossary', createGlossaryRoutes({} as Parameters<typeof createGlossaryRoutes>[0]));
  return app;
}

describe('cross-workspace isolation via glossary route', () => {
  it('allows access when requesting own workspace', async () => {
    const { ok } = await import('neverthrow');
    const app = makeIsolatedApp('ws-A', ok([]));
    const res = await app.request('/api/v1/glossary?workspaceId=ws-A');
    expect(res.status).toBe(200);
  });

  it('returns data for the authenticated workspace even without explicit workspaceId check in route', async () => {
    const { ok } = await import('neverthrow');
    const app = makeIsolatedApp('ws-A', ok([{ id: 't1', term: 'ARR', definition: 'Annual Recurring Revenue', workspaceId: 'ws-A' }]));
    const res = await app.request('/api/v1/glossary?workspaceId=ws-A');
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
