import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { requireAdminRole } from '../../middleware/admin-auth.js';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(),
  clerkMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import { getAuth } from '@hono/clerk-auth';
const mockGetAuth = vi.mocked(getAuth);

function makeApp() {
  const app = new Hono();
  app.use('*', requireAdminRole);
  app.get('/admin', (c) => c.json({ ok: true }));
  return app;
}

describe('requireAdminRole', () => {
  it('returns 401 when no auth session', async () => {
    mockGetAuth.mockReturnValueOnce(null);
    const res = await makeApp().request('/admin');
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when userId is missing from session', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: null } as never);
    const res = await makeApp().request('/admin');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is authenticated but not admin', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_123', orgRole: 'member' } as never);
    const res = await makeApp().request('/admin');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 403 when orgRole is undefined', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_123' } as never);
    const res = await makeApp().request('/admin');
    expect(res.status).toBe(403);
  });

  it('allows access when orgRole is admin', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_admin', orgRole: 'admin' } as never);
    const res = await makeApp().request('/admin');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns structured error envelope on 403', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'user_123', orgRole: 'viewer' } as never);
    const res = await makeApp().request('/admin');
    const body = await res.json() as { error: { message: string } };
    expect(typeof body.error.message).toBe('string');
  });

  it('does not leak internal details in 401 response', async () => {
    mockGetAuth.mockReturnValueOnce(null);
    const res = await makeApp().request('/admin');
    const text = await res.text();
    expect(text).not.toContain('stack');
  });

  it('403 message references admin access requirement', async () => {
    mockGetAuth.mockReturnValueOnce({ userId: 'u', orgRole: 'basic' } as never);
    const res = await makeApp().request('/admin');
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('admin');
  });
});
