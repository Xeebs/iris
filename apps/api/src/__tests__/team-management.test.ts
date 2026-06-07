import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(() => ({ userId: 'user-123', orgId: 'ws-test' })),
  clerkMiddleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('@iris/core/email-service', () => ({
  EmailService: vi.fn(),
  buildInviteEmail: vi.fn(() => ({
    subject: 'You have been invited',
    html: '<p>Invite</p>',
    text: 'Invite',
  })),
}));

import { createTeamManagementRoutes } from '../routes/team-management.js';

const mockSqlFn = Object.assign(
  vi.fn((..._args: unknown[]) => Promise.resolve([])),
  {
    begin: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      const mockTx = Object.assign(
        vi.fn((..._args: unknown[]) => Promise.resolve([])),
        { begin: vi.fn() },
      );
      await fn(mockTx);
    }),
  },
) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-test') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createTeamManagementRoutes(mockSqlFn));
  return app;
}

describe('team-management routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqlFn.mockResolvedValue([]);
    (mockSqlFn as unknown as { begin: ReturnType<typeof vi.fn> }).begin = vi.fn(
      async (fn: (tx: unknown) => Promise<void>) => {
        const mockTx = Object.assign(vi.fn(() => Promise.resolve([])), { begin: vi.fn() });
        await fn(mockTx);
      },
    );
  });

  describe('GET /', () => {
    it('returns paginated list of members', async () => {
      mockSqlFn.mockResolvedValueOnce([
        {
          id: 'm1', workspace_id: 'ws-test', user_id: 'u1', email: 'alice@example.com',
          role: 'admin', invite_status: 'active', joined_at: new Date(), created_at: new Date(),
        },
      ]);
      const app = makeApp();

      const res = await app.request('/');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[]; meta: { hasMore: boolean } };
      expect(body.data).toHaveLength(1);
      expect(body.meta.hasMore).toBe(false);
    });

    it('filters by status param', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/?status=pending');

      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid status', async () => {
      const app = makeApp();
      const res = await app.request('/?status=invalid');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /invite', () => {
    it('returns 201 on successful invitation', async () => {
      mockSqlFn.mockResolvedValueOnce([]); // no existing member
      const app = makeApp();

      const res = await app.request('/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'bob@example.com',
          role: 'member',
          inviterName: 'Alice',
          workspaceName: 'Acme',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { email: string; status: string } };
      expect(body.data.email).toBe('bob@example.com');
      expect(body.data.status).toBe('pending');
    });

    it('returns 400 for invalid email', async () => {
      const app = makeApp();

      const res = await app.request('/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 when member already exists', async () => {
      mockSqlFn.mockResolvedValueOnce([{ id: 'existing', invite_status: 'active' }]);
      const app = makeApp();

      const res = await app.request('/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'existing@example.com', role: 'member' }),
      });

      expect(res.status).toBe(409);
    });

    it('returns 400 when request body is missing', async () => {
      const app = makeApp();
      const res = await app.request('/invite', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('defaults role to member when not specified', async () => {
      mockSqlFn.mockResolvedValueOnce([]); // no existing
      const app = makeApp();

      const res = await app.request('/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'charlie@example.com' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { role: string } };
      expect(body.data.role).toBe('member');
    });
  });

  describe('POST /accept/:token', () => {
    it('returns 200 when invitation is accepted', async () => {
      mockSqlFn.mockResolvedValueOnce([
        { id: 'inv-1', workspace_id: 'ws-test', email: 'bob@example.com', role: 'member' },
      ]);
      const app = makeApp();

      const res = await app.request('/accept/valid-token-abc', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { role: string; status: string } };
      expect(body.data.status).toBe('active');
    });

    it('returns 404 for expired/invalid token', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/accept/expired-token', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:userId/role', () => {
    it('updates member role and returns updated member', async () => {
      mockSqlFn.mockResolvedValueOnce([
        { id: 'm1', user_id: 'u1', email: 'alice@example.com', role: 'admin' },
      ]);
      const app = makeApp();

      const res = await app.request('/u1/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'admin' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { role: string } };
      expect(body.data.role).toBe('admin');
    });

    it('returns 400 for invalid role value', async () => {
      const app = makeApp();

      const res = await app.request('/u1/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'superuser' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 when member not found', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/nonexistent/role', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:userId', () => {
    it('removes member and returns status', async () => {
      mockSqlFn.mockResolvedValueOnce([{ id: 'm1' }]);
      const app = makeApp();

      const res = await app.request('/u1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('removed');
    });

    it('returns 404 when member not found', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/notexist', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /invitations', () => {
    it('returns pending invitations', async () => {
      mockSqlFn.mockResolvedValueOnce([
        {
          id: 'inv-1', email: 'invited@example.com', role: 'member',
          invited_by: 'Alice', expires_at: new Date(), created_at: new Date(),
        },
      ]);
      const app = makeApp();

      const res = await app.request('/invitations');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });
  });

  describe('DELETE /invitations/:id', () => {
    it('revokes invitation and returns status', async () => {
      mockSqlFn.mockResolvedValueOnce([{ id: 'inv-1' }]);
      const app = makeApp();

      const res = await app.request('/invitations/inv-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('revoked');
    });

    it('returns 404 when invitation not found', async () => {
      mockSqlFn.mockResolvedValueOnce([]);
      const app = makeApp();

      const res = await app.request('/invitations/missing', { method: 'DELETE' });

      expect(res.status).toBe(404);
    });
  });
});
