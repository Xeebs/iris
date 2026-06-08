import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac, timingSafeEqual } from 'crypto';
import { Hono } from 'hono';

vi.mock('@iris/core/logger', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import type postgres from 'postgres';
import { createWebhookRoutes, createWebhookEventsRoutes } from '../routes/webhooks.js';

type SqlClient = ReturnType<typeof postgres>;

const HUBSPOT_SECRET = process.env['HUBSPOT_CLIENT_SECRET'] = 'test-hs-secret';
const SLACK_SECRET = process.env['SLACK_SIGNING_SECRET'] = 'test-slack-secret';

function makeHubSpotSignature(body: string): string {
  return createHmac('sha256', HUBSPOT_SECRET).update(body).digest('hex');
}

function makeSlackSignature(body: string, timestamp: string): string {
  const sigBase = `v0:${timestamp}:${body}`;
  return `v0=${createHmac('sha256', SLACK_SECRET).update(sigBase).digest('hex')}`;
}

function makeSql(connectorId: string, secret: string): SqlClient {
  const fn = vi.fn().mockResolvedValue([{
    id: 'inst-001',
    workspace_id: 'ws-001',
    connector_id: connectorId,
    webhook_secret: secret,
  }]);
  return fn as unknown as SqlClient;
}

function makeSqlNotFound(): SqlClient {
  const fn = vi.fn().mockResolvedValue([]);
  return fn as unknown as SqlClient;
}

function makeApp(sql: SqlClient): Hono {
  const app = new Hono();
  app.route('/api/v1/webhooks', createWebhookRoutes(sql));
  return app;
}

const INSTANCE_SECRET = 'url-secret-token';

describe('POST /api/v1/webhooks/:instanceId/:secret', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('HubSpot connector', () => {
    it('returns 200 with entitiesQueued for valid HubSpot webhook', async () => {
      const sql = makeSql('hubspot', INSTANCE_SECRET);
      const app = makeApp(sql);

      const events = [
        {
          eventId: 1,
          subscriptionId: 100,
          portalId: 999,
          appId: 1,
          occurredAt: Date.now(),
          subscriptionType: 'contact.propertyChange',
          attemptNumber: 0,
          objectId: 55001,
          propertyName: 'email',
          propertyValue: 'new@test.com',
        },
      ];
      const body = JSON.stringify(events);
      const signature = makeHubSpotSignature(body);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hubspot-signature': signature },
        body,
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { entitiesQueued: number; workspaceId: string } };
      expect(json.data.entitiesQueued).toBe(1);
      expect(json.data.workspaceId).toBe('ws-001');
    });

    it('returns 401 when HubSpot signature is missing', async () => {
      const sql = makeSql('hubspot', INSTANCE_SECRET);
      const app = makeApp(sql);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '[]',
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 for invalid HubSpot signature', async () => {
      const sql = makeSql('hubspot', INSTANCE_SECRET);
      const app = makeApp(sql);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: { 'x-hubspot-signature': 'bad-signature' },
        body: '[]',
      });

      expect(res.status).toBe(401);
    });

    it('returns 0 entitiesQueued for events without propertyName', async () => {
      const sql = makeSql('hubspot', INSTANCE_SECRET);
      const app = makeApp(sql);

      const events = [
        {
          eventId: 1,
          subscriptionId: 100,
          portalId: 999,
          appId: 1,
          occurredAt: Date.now(),
          subscriptionType: 'contact.creation',
          attemptNumber: 0,
          objectId: 55002,
        },
      ];
      const body = JSON.stringify(events);
      const signature = makeHubSpotSignature(body);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: { 'x-hubspot-signature': signature },
        body,
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { entitiesQueued: number } };
      expect(json.data.entitiesQueued).toBe(0);
    });
  });

  describe('Slack connector', () => {
    it('returns 200 for valid Slack event webhook', async () => {
      const sql = makeSql('slack', INSTANCE_SECRET);
      const app = makeApp(sql);

      const slackPayload = {
        type: 'event_callback',
        team_id: 'T001',
        event: {
          type: 'message',
          channel: 'C001',
          text: 'Hello Iris',
          ts: '1234567890.000001',
          event_ts: '1234567890.000001',
          user: 'U001',
        },
        event_id: 'Ev001',
        event_time: 1234567890,
      };
      const body = JSON.stringify(slackPayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = makeSlackSignature(body, timestamp);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { data: { entitiesQueued: number } };
      expect(json.data.entitiesQueued).toBe(1);
    });

    it('returns challenge response for Slack URL verification', async () => {
      const sql = makeSql('slack', INSTANCE_SECRET);
      const app = makeApp(sql);

      const challengePayload = {
        type: 'url_verification',
        challenge: 'test-challenge-token',
      };
      const body = JSON.stringify(challengePayload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = makeSlackSignature(body, timestamp);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: {
          'x-slack-request-timestamp': timestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(res.status).toBe(200);
      const json = await res.json() as { challenge: string };
      expect(json.challenge).toBe('test-challenge-token');
    });

    it('returns 401 when Slack signature headers are missing', async () => {
      const sql = makeSql('slack', INSTANCE_SECRET);
      const app = makeApp(sql);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: {},
        body: '{}',
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 for expired Slack timestamp (replay attack)', async () => {
      const sql = makeSql('slack', INSTANCE_SECRET);
      const app = makeApp(sql);

      const body = '{}';
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
      const signature = makeSlackSignature(body, oldTimestamp);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        headers: {
          'x-slack-request-timestamp': oldTimestamp,
          'x-slack-signature': signature,
        },
        body,
      });

      expect(res.status).toBe(401);
    });
  });

  describe('instance resolution', () => {
    it('returns 404 when instance or secret does not match', async () => {
      const sql = makeSqlNotFound();
      const app = makeApp(sql);

      const res = await app.request('/api/v1/webhooks/inst-unknown/wrong-secret', {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(404);
    });

    it('returns 422 for unsupported connector type', async () => {
      const sql = makeSql('notion', INSTANCE_SECRET);
      const app = makeApp(sql);

      const res = await app.request(`/api/v1/webhooks/inst-001/${INSTANCE_SECRET}`, {
        method: 'POST',
        body: '{}',
      });

      expect(res.status).toBe(422);
    });
  });
});

// ---------------------------------------------------------------------------
// Webhook event delivery status routes
// ---------------------------------------------------------------------------

type SqlClient = ReturnType<typeof postgres>;

function makeEventsSql(rows: Record<string, unknown>[]): SqlClient {
  const fn = vi.fn().mockResolvedValue(rows);
  return fn as unknown as SqlClient;
}

function makeEventsApp(sql: SqlClient): Hono {
  const app = new Hono();
  app.route('/api/v1/webhooks', createWebhookEventsRoutes(sql));
  return app;
}

const SAMPLE_EVENTS = [
  {
    id: 'evt-001',
    workspace_id: 'ws-test',
    webhook_id: 'wh-1',
    event_type: 'connector.sync.completed',
    target_url: 'https://example.com/hook',
    status: 'delivered',
    attempt_count: 1,
    http_status: 200,
    error_message: null,
    next_retry_at: null,
    completed_at: new Date('2026-06-07T10:00:00Z'),
    created_at: new Date('2026-06-07T09:59:55Z'),
    updated_at: new Date('2026-06-07T10:00:00Z'),
  },
  {
    id: 'evt-002',
    workspace_id: 'ws-test',
    webhook_id: 'wh-2',
    event_type: 'connector.sync.failed',
    target_url: 'https://example.com/hook',
    status: 'failed',
    attempt_count: 3,
    http_status: 500,
    error_message: 'Internal server error',
    next_retry_at: new Date('2026-06-07T10:05:00Z'),
    completed_at: null,
    created_at: new Date('2026-06-07T09:58:00Z'),
    updated_at: new Date('2026-06-07T10:00:00Z'),
  },
];

describe('GET /api/v1/webhooks/events', () => {
  it('returns paginated webhook events for a workspace', async () => {
    const app = makeEventsApp(makeEventsSql(SAMPLE_EVENTS));

    const res = await app.request('/api/v1/webhooks/events?workspaceId=ws-test');
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(2);
    expect(body.meta.hasMore).toBe(false);

    const first = body.data[0] as Record<string, unknown>;
    expect(first['id']).toBe('evt-001');
    expect(first['status']).toBe('delivered');
    expect(first['eventType']).toBe('connector.sync.completed');
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeEventsApp(makeEventsSql([]));
    const res = await app.request('/api/v1/webhooks/events');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid status filter value', async () => {
    const app = makeEventsApp(makeEventsSql([]));
    const res = await app.request('/api/v1/webhooks/events?workspaceId=ws-test&status=invalid');
    expect(res.status).toBe(400);
  });

  it('sets hasMore=true and nextCursor when more events exist', async () => {
    const manyRows = Array.from({ length: 51 }, (_, i) => ({
      ...SAMPLE_EVENTS[0],
      id: `evt-${String(i).padStart(3, '0')}`,
    }));
    const app = makeEventsApp(makeEventsSql(manyRows));

    const res = await app.request('/api/v1/webhooks/events?workspaceId=ws-test&limit=50');
    expect(res.status).toBe(200);

    const body = await res.json() as { data: unknown[]; meta: { hasMore: boolean; nextCursor?: string } };
    expect(body.data).toHaveLength(50);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.nextCursor).toBeDefined();
  });

  it('returns 500 on database error', async () => {
    const sql = vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      // Empty fragment calls (sql``) have one string and no values — return harmless value
      if (strings.length === 1 && values.length === 0) return [];
      return Promise.reject(new Error('DB error'));
    }) as unknown as SqlClient;
    const app = makeEventsApp(sql);
    const res = await app.request('/api/v1/webhooks/events?workspaceId=ws-test');
    expect(res.status).toBe(500);
  });
});
