import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/event-driven-sync-engine', () => ({
  getEventStreamConfig: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: { connectorId: 'hubspot', workspaceId: 'ws1', enabled: true, eventTypes: ['entity_created', 'entity_updated'], configJson: {} },
  })),
  upsertEventStreamConfig: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  enqueueChangeEvent: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  getEventAuditLog: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: {
      entries: [
        { eventId: 'e1', connectorId: 'hubspot', entityId: 'c1', changeType: 'entity_updated', changeSummary: 'Updated contact', deliveredAt: new Date('2026-06-08'), latencyMs: 40 },
      ],
      nextCursor: null,
    },
  })),
  markEventFailed: vi.fn(async () => ({ isOk: () => true, isErr: () => false })),
  getPendingRetryEvents: vi.fn(async () => ({
    isOk: () => true, isErr: () => false,
    value: [{ eventId: 'e1', status: 'failed', retryCount: 1, nextRetryAt: null, deliveredAt: null }],
  })),
}));

vi.mock('@iris/core/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}));

import routeModule from '../routes/event-streams';

function buildApp() {
  const app = new Hono();
  app.route('/api/v1', routeModule);
  return app;
}

describe('GET /api/v1/connectors/:connectorId/event-config', () => {
  it('returns stream config for connector', async () => {
    const res = await buildApp().request('/api/v1/connectors/hubspot/event-config', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { enabled: boolean; eventTypes: string[] } };
    expect(body.data.enabled).toBe(true);
    expect(body.data.eventTypes).toContain('entity_created');
  });
});

describe('PUT /api/v1/connectors/:connectorId/event-config', () => {
  it('updates config and returns success', async () => {
    const res = await buildApp().request('/api/v1/connectors/hubspot/event-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ enabled: true, eventTypes: ['entity_created'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { enabled: boolean } };
    expect(body.data.enabled).toBe(true);
  });

  it('returns 400 for invalid eventType', async () => {
    const res = await buildApp().request('/api/v1/connectors/hubspot/event-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ enabled: true, eventTypes: ['invalid_type'] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await buildApp().request('/api/v1/connectors/hubspot/event-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ eventTypes: ['entity_created'] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/connectors/:connectorId/events', () => {
  it('enqueues event and returns 201', async () => {
    const res = await buildApp().request('/api/v1/connectors/hubspot/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({
        eventId: 'evt-1',
        entityId: 'hubspot:contact:1',
        entityType: 'contact',
        changeType: 'entity_updated',
        payload: { name: 'Alice' },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { eventId: string; status: string } };
    expect(body.data.eventId).toBe('evt-1');
    expect(body.data.status).toBe('pending');
  });

  it('returns 400 for missing entityId', async () => {
    const res = await buildApp().request('/api/v1/connectors/hubspot/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-workspace-id': 'ws1' },
      body: JSON.stringify({ eventId: 'e1', entityType: 'contact', changeType: 'entity_updated' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/events/audit', () => {
  it('returns audit entries with pagination meta', async () => {
    const res = await buildApp().request('/api/v1/events/audit', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ eventId: string }>; meta: { hasMore: boolean } };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.eventId).toBe('e1');
    expect(body.meta.hasMore).toBe(false);
  });
});

describe('POST /api/v1/events/:eventId/retry', () => {
  it('schedules retry and returns scheduled: true', async () => {
    const res = await buildApp().request('/api/v1/events/evt-1/retry', {
      method: 'POST',
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { scheduled: boolean } };
    expect(body.data.scheduled).toBe(true);
  });
});

describe('GET /api/v1/events/pending-retry', () => {
  it('returns pending retry events with count', async () => {
    const res = await buildApp().request('/api/v1/events/pending-retry', {
      headers: { 'x-workspace-id': 'ws1' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ eventId: string }>; meta: { count: number } };
    expect(body.data).toHaveLength(1);
    expect(body.meta.count).toBe(1);
  });
});
