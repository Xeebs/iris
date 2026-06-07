import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createAlertsRoutes } from '../routes/alerts.js';

vi.mock('@hono/clerk-auth', () => ({
  getAuth: vi.fn(() => ({ userId: 'user-1', orgId: 'ws-test' })),
  clerkMiddleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => next()),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock('@iris/semantic-core/alerts', () => {
  const mockSvc = {
    listRules: vi.fn(),
    createRule: vi.fn(),
    deleteRule: vi.fn(),
    listChannels: vi.fn(),
    createChannel: vi.fn(),
    deleteChannel: vi.fn(),
    evaluateRules: vi.fn(),
    listEvents: vi.fn(),
    sendAlert: vi.fn(),
  };
  return {
    AlertsService: vi.fn(() => mockSvc),
    _mockSvc: mockSvc,
  };
});

import { _mockSvc as mockSvc } from '@iris/semantic-core/alerts';
import { ok, err } from 'neverthrow';

const mockSqlFn = vi.fn((..._args: unknown[]) => Promise.resolve([])) as unknown as ReturnType<typeof import('postgres').default>;

function makeApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('workspaceId', 'ws-test');
    await next();
  });
  app.route('/', createAlertsRoutes(mockSqlFn));
  return app;
}

const ruleFixture = {
  id: 'rule-1',
  workspaceId: 'ws-test',
  name: 'Sync failures',
  condition: 'sync_failure' as const,
  threshold: 3,
  enabled: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const channelFixture = {
  id: 'chan-1',
  workspaceId: 'ws-test',
  name: 'Slack ops',
  type: 'slack' as const,
  config: { webhookUrl: 'https://hooks.slack.com/x' },
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('alerts routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /rules', () => {
    it('returns list of alert rules', async () => {
      mockSvc.listRules.mockResolvedValueOnce(ok([ruleFixture]));
      const app = makeApp();
      const res = await app.request('/rules');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('returns 500 on db error', async () => {
      mockSvc.listRules.mockResolvedValueOnce(err(new Error('db down')));
      const app = makeApp();
      const res = await app.request('/rules');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /rules', () => {
    it('creates a new rule and returns 201', async () => {
      mockSvc.createRule.mockResolvedValueOnce(ok(ruleFixture));
      const app = makeApp();
      const res = await app.request('/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sync failures', condition: 'sync_failure', threshold: 3 }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 on invalid body', async () => {
      const app = makeApp();
      const res = await app.request('/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'bad' }), // missing condition
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /rules/:id', () => {
    it('deletes a rule and returns ok', async () => {
      mockSvc.deleteRule.mockResolvedValueOnce(ok(undefined));
      const app = makeApp();
      const res = await app.request('/rules/rule-1', { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { deleted: boolean } };
      expect(body.data.deleted).toBe(true);
    });
  });

  describe('GET /channels', () => {
    it('returns list of channels', async () => {
      mockSvc.listChannels.mockResolvedValueOnce(ok([channelFixture]));
      const app = makeApp();
      const res = await app.request('/channels');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST /channels', () => {
    it('creates channel and returns 201', async () => {
      mockSvc.createChannel.mockResolvedValueOnce(ok(channelFixture));
      const app = makeApp();
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Slack ops', type: 'slack', config: { webhookUrl: 'https://x' } }),
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid channel type', async () => {
      const app = makeApp();
      const res = await app.request('/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'bad', type: 'fax', config: {} }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /events', () => {
    it('returns recent alert events', async () => {
      const eventFixture = {
        id: 'evt-1', workspaceId: 'ws-test', ruleId: 'rule-1',
        channelId: 'chan-1', status: 'delivered', payload: null, errorMessage: null,
        sentAt: new Date(),
      };
      mockSvc.listEvents.mockResolvedValueOnce(ok([eventFixture]));
      const app = makeApp();
      const res = await app.request('/events');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });
  });

  describe('POST /evaluate', () => {
    it('returns count of triggered alerts', async () => {
      mockSvc.evaluateRules.mockResolvedValueOnce(ok(2));
      const app = makeApp();
      const res = await app.request('/evaluate', { method: 'POST' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { triggered: number } };
      expect(body.data.triggered).toBe(2);
    });

    it('returns 500 on evaluation error', async () => {
      mockSvc.evaluateRules.mockResolvedValueOnce(err(new Error('metric fetch failed')));
      const app = makeApp();
      const res = await app.request('/evaluate', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });
});
