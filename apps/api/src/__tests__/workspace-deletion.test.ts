import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(() => ({ userId: 'user-admin' })),
  clerkMiddleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('@iris/semantic-core/workspace-deletion', () => {
  const mockService = {
    getDeletionStatus: vi.fn(),
    getPolicy: vi.fn(),
    requestDeletion: vi.fn(),
    cancelDeletion: vi.fn(),
    updatePolicy: vi.fn(),
    permanentlyDelete: vi.fn(),
  };
  return {
    WorkspaceDeletionService: vi.fn(() => mockService),
    _mockService: mockService,
  };
});

import { createWorkspaceDeletionRoutes } from '../routes/workspace-deletion.js';
import { WorkspaceDeletionService, _mockService as mockSvc } from '@iris/semantic-core/workspace-deletion';

const mockSqlFn = vi.fn() as unknown as ReturnType<typeof import('postgres').default>;

function makeApp(workspaceId = 'ws-test') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', workspaceId);
    await next();
  });
  app.route('/', createWorkspaceDeletionRoutes(mockSqlFn));
  return app;
}

const { ok, err } = await import('neverthrow');

describe('workspace-deletion routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /status', () => {
    it('returns null request and default policy when none exist', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['getDeletionStatus'].mockResolvedValue(ok(null));
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['getPolicy'].mockResolvedValue(ok({
        workspaceId: 'ws-test',
        retentionDays: 30,
        backupBeforeDeletion: true,
        legalHold: false,
      }));

      const app = makeApp();
      const res = await app.request('/status');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { request: null; policy: unknown } };
      expect(body.data.request).toBeNull();
      expect(body.data.policy).toBeTruthy();
    });

    it('returns active deletion request when one exists', async () => {
      const scheduledAt = new Date(Date.now() + 30 * 86400000);
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['getDeletionStatus'].mockResolvedValue(ok({
        id: 'req-1',
        workspaceId: 'ws-test',
        requestedBy: 'user-admin',
        status: 'pending',
        scheduledAt,
        createdAt: new Date(),
      }));
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['getPolicy'].mockResolvedValue(ok({
        workspaceId: 'ws-test',
        retentionDays: 30,
        backupBeforeDeletion: true,
        legalHold: false,
      }));

      const app = makeApp();
      const res = await app.request('/status');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { request: { status: string } } };
      expect(body.data.request?.status).toBe('pending');
    });
  });

  describe('POST /request', () => {
    it('creates a deletion request and returns 201', async () => {
      const scheduledAt = new Date(Date.now() + 30 * 86400000);
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['requestDeletion'].mockResolvedValue(ok({
        id: 'req-1',
        workspaceId: 'ws-test',
        requestedBy: 'user-admin',
        status: 'pending',
        scheduledAt,
        createdAt: new Date(),
      }));

      const app = makeApp();
      const res = await app.request('/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Closing the account' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('pending');
    });

    it('returns 400 when body is missing', async () => {
      const app = makeApp();
      const res = await app.request('/request', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    it('returns 409 when a deletion request already exists', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['requestDeletion'].mockResolvedValue(
        err(new Error('A deletion request is already pending for this workspace')),
      );

      const app = makeApp();
      const res = await app.request('/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'duplicate attempt' }),
      });

      expect(res.status).toBe(409);
    });

    it('returns 409 when workspace is under legal hold', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['requestDeletion'].mockResolvedValue(
        err(new Error('Workspace is under legal hold and cannot be deleted')),
      );

      const app = makeApp();
      const res = await app.request('/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'gdpr' }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('PUT /cancel', () => {
    it('cancels pending deletion and returns updated request', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['cancelDeletion'].mockResolvedValue(ok({
        id: 'req-1',
        workspaceId: 'ws-test',
        requestedBy: 'user-admin',
        status: 'cancelled',
        scheduledAt: new Date(),
        cancelledAt: new Date(),
        createdAt: new Date(),
      }));

      const app = makeApp();
      const res = await app.request('/cancel', { method: 'PUT' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { status: string } };
      expect(body.data.status).toBe('cancelled');
    });

    it('returns 404 when no cancellable request exists', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['cancelDeletion'].mockResolvedValue(
        err(new Error('No cancellable deletion request found')),
      );

      const app = makeApp();
      const res = await app.request('/cancel', { method: 'PUT' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /policy', () => {
    it('returns the workspace retention policy', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['getPolicy'].mockResolvedValue(ok({
        workspaceId: 'ws-test',
        retentionDays: 60,
        backupBeforeDeletion: true,
        legalHold: false,
      }));

      const app = makeApp();
      const res = await app.request('/policy');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { retentionDays: number } };
      expect(body.data.retentionDays).toBe(60);
    });
  });

  describe('PUT /policy', () => {
    it('updates the retention policy and returns updated values', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['updatePolicy'].mockResolvedValue(ok({
        workspaceId: 'ws-test',
        retentionDays: 90,
        backupBeforeDeletion: false,
        legalHold: false,
      }));

      const app = makeApp();
      const res = await app.request('/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: 90, backupBeforeDeletion: false }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { retentionDays: number; backupBeforeDeletion: boolean } };
      expect(body.data.retentionDays).toBe(90);
      expect(body.data.backupBeforeDeletion).toBe(false);
    });

    it('returns 400 for invalid retentionDays value', async () => {
      const app = makeApp();
      const res = await app.request('/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: 3 }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /execute', () => {
    it('returns 404 when no active deletion request exists', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['permanentlyDelete'].mockResolvedValue(
        err(new Error('No active deletion request found for workspace')),
      );

      const app = makeApp();
      const res = await app.request('/execute', { method: 'POST' });

      expect(res.status).toBe(404);
    });

    it('returns 422 when grace period has not elapsed', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['permanentlyDelete'].mockResolvedValue(
        err(new Error('Grace period has not elapsed — deletion scheduled for 2099-01-01')),
      );

      const app = makeApp();
      const res = await app.request('/execute', { method: 'POST' });

      expect(res.status).toBe(422);
    });

    it('returns 200 when deletion succeeds', async () => {
      (mockSvc as unknown as Record<string, ReturnType<typeof vi.fn>>)['permanentlyDelete'].mockResolvedValue(ok({
        workspace_members: 5,
        glossary_terms: 20,
      }));

      const app = makeApp();
      const res = await app.request('/execute', { method: 'POST' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);
    });
  });
});
