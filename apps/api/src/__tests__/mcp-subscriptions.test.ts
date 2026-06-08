import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

vi.mock('@iris/semantic-core/mcp-subscriptions', () => {
  const mockSubscribe = vi.fn();
  const mockUnsubscribe = vi.fn();
  const mockList = vi.fn();
  const mockListEvents = vi.fn();
  return {
    MCPSubscriptionManager: vi.fn().mockImplementation(() => ({
      subscribe: mockSubscribe,
      unsubscribe: mockUnsubscribe,
      listSubscriptions: mockList,
      listEvents: mockListEvents,
    })),
    createSubscriptionSchema: {
      safeParse: vi.fn(),
    },
    __mocks: { mockSubscribe, mockUnsubscribe, mockList, mockListEvents },
  };
});

import { createMcpSubscriptionRoutes } from '../routes/mcp-subscriptions.js';
import { MCPSubscriptionManager, createSubscriptionSchema } from '@iris/semantic-core/mcp-subscriptions';

function makeApp() {
  const sql = vi.fn() as unknown as Parameters<typeof createMcpSubscriptionRoutes>[0];
  const app = new Hono();
  app.route('/mcp', createMcpSubscriptionRoutes(sql));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const validSubscription = {
  id: 'sub-1',
  workspaceId: 'ws-1',
  clientId: 'client-1',
  filters: {},
  createdAt: new Date('2026-06-08'),
  lastNotifiedAt: null,
};

describe('POST /mcp/subscribe', () => {
  it('returns 400 for invalid JSON', async () => {
    const app = makeApp();
    const res = await app.request('/mcp/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('INVALID_JSON');
  });

  it('returns 400 for validation failure', async () => {
    (createSubscriptionSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: false,
      error: { message: 'workspaceId required', issues: [] },
    });

    const app = makeApp();
    const res = await app.request('/mcp/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 201 with subscription on success', async () => {
    (createSubscriptionSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValue({
      success: true,
      data: { workspaceId: 'ws-1', clientId: 'client-1', filters: {} },
    });

    const { ok } = await import('neverthrow');
    const inst = { subscribe: vi.fn().mockResolvedValue(ok(validSubscription)), unsubscribe: vi.fn(), listSubscriptions: vi.fn(), listEvents: vi.fn() };
    (MCPSubscriptionManager as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/mcp/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1', clientId: 'client-1' }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { data: { id: string } };
    expect(json.data.id).toBe('sub-1');
  });
});

describe('DELETE /mcp/subscriptions/:id', () => {
  it('returns 200 on success', async () => {
    const { ok } = await import('neverthrow');
    const inst = { unsubscribe: vi.fn().mockResolvedValue(ok(undefined)), subscribe: vi.fn(), listSubscriptions: vi.fn(), listEvents: vi.fn() };
    (MCPSubscriptionManager as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/mcp/subscriptions/sub-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'ws-1' }),
    });

    expect(res.status).toBe(200);
  });

  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/mcp/subscriptions/sub-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /mcp/subscriptions', () => {
  it('returns 400 when workspaceId is missing', async () => {
    const app = makeApp();
    const res = await app.request('/mcp/subscriptions');
    expect(res.status).toBe(400);
  });

  it('returns subscriptions list', async () => {
    const { ok } = await import('neverthrow');
    const inst = { listSubscriptions: vi.fn().mockResolvedValue(ok([validSubscription])), subscribe: vi.fn(), unsubscribe: vi.fn(), listEvents: vi.fn() };
    (MCPSubscriptionManager as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/mcp/subscriptions?workspaceId=ws-1');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });
});

describe('GET /mcp/subscriptions/:id/events', () => {
  it('returns events list', async () => {
    const { ok } = await import('neverthrow');
    const inst = { listEvents: vi.fn().mockResolvedValue(ok([{ event_id: 'ev-1' }])), subscribe: vi.fn(), unsubscribe: vi.fn(), listSubscriptions: vi.fn() };
    (MCPSubscriptionManager as ReturnType<typeof vi.fn>).mockImplementation(() => inst);

    const app = makeApp();
    const res = await app.request('/mcp/subscriptions/sub-1/events');
    expect(res.status).toBe(200);
    const json = await res.json() as { data: unknown[] };
    expect(json.data).toHaveLength(1);
  });
});
