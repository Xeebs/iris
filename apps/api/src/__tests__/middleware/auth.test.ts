import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requireAuth, injectWorkspace, assertWorkspaceMatch } from '../../middleware/auth.js';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(),
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
  createMiddleware: (fn: unknown) => fn,
}));

import { getAuth } from '@hono/clerk-auth';
const mockGetAuth = vi.mocked(getAuth);

function makeRequireAuthApp() {
  const app = new Hono();
  app.use('*', requireAuth);
  app.get('/protected', (c) => c.json({ ok: true }));
  return app;
}

function makeInjectWorkspaceApp() {
  const app = new Hono();
  app.use('*', injectWorkspace);
  app.get('/ws', (c) => c.json({ workspaceId: c.get('workspaceId') }));
  return app;
}

// ─── requireAuth ─────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  it('returns 401 when no session exists', async () => {
    mockGetAuth.mockReturnValueOnce(null);
    const res = await makeRequireAuthApp().request('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 when userId is null', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: null } as never);
    const res = await makeRequireAuthApp().request('/protected');
    expect(res.status).toBe(401);
  });

  it('returns UNAUTHENTICATED error code on 401', async () => {
    mockGetAuth.mockReturnValueOnce(null);
    const res = await makeRequireAuthApp().request('/protected');
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('allows access with valid userId', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_123' } as never);
    const res = await makeRequireAuthApp().request('/protected');
    expect(res.status).toBe(200);
  });
});

// ─── injectWorkspace ──────────────────────────────────────────────────────────

describe('injectWorkspace', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuth.mockReturnValueOnce(null);
    const res = await makeInjectWorkspaceApp().request('/ws');
    expect(res.status).toBe(401);
  });

  it('uses orgId as workspaceId for multi-tenant sessions', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_1', orgId: 'org_abc' } as never);
    const res = await makeInjectWorkspaceApp().request('/ws');
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('org_abc');
  });

  it('falls back to userId when orgId is absent', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_solo', orgId: null } as never);
    const res = await makeInjectWorkspaceApp().request('/ws');
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('user_solo');
  });

  it('injects workspaceId into context accessible by downstream handlers', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_2', orgId: 'org_xyz' } as never);
    const res = await makeInjectWorkspaceApp().request('/ws');
    const body = await res.json() as { workspaceId: string };
    expect(body.workspaceId).toBe('org_xyz');
  });
});

// ─── assertWorkspaceMatch ─────────────────────────────────────────────────────

describe('assertWorkspaceMatch', () => {
  it('returns null when IDs match', () => {
    expect(assertWorkspaceMatch('org_abc', 'org_abc')).toBeNull();
  });

  it('returns error message string when IDs differ', () => {
    const msg = assertWorkspaceMatch('org_abc', 'org_xyz');
    expect(typeof msg).toBe('string');
    expect(msg).not.toBeNull();
  });

  it('error message includes the requested workspace ID', () => {
    const msg = assertWorkspaceMatch('org_attacker', 'org_victim') ?? '';
    expect(msg).toContain('org_attacker');
  });
});
