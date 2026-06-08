import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EntitySubscriptionManager, type EntityUpdatePayload } from '../entity-subscriptions.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

function makeWs(readyState = 1) {
  const messages: string[] = [];
  return {
    readyState,
    send: vi.fn((msg: string) => messages.push(msg)),
    close: vi.fn(),
    on: vi.fn(),
    _messages: messages,
  };
}

type FakeWs = ReturnType<typeof makeWs>;
type FakeWss = { on: ReturnType<typeof vi.fn> };

function attachManager(manager: EntitySubscriptionManager, workspaceId = 'ws-1') {
  let connectionHandler: ((ws: FakeWs, req: { url: string }) => void) | undefined;
  const wss: FakeWss = {
    on: vi.fn((event: string, handler: (ws: FakeWs, req: { url: string }) => void) => {
      if (event === 'connection') connectionHandler = handler;
    }),
  };
  manager.attach(wss as unknown as Parameters<typeof manager.attach>[0]);

  const connect = (ws = makeWs(), wsId = workspaceId) => {
    const messageHandlers: Array<(data: Buffer) => void> = [];
    ws.on.mockImplementation((event: string, handler: () => void) => {
      if (event === 'message') messageHandlers.push(handler as (data: Buffer) => void);
    });
    connectionHandler?.(ws, { url: `ws://localhost/ws/entities?workspaceId=${wsId}` });
    const send = (msg: object) => messageHandlers[0]?.(Buffer.from(JSON.stringify(msg)));
    return { ws, send };
  };

  return { wss, connect };
}

describe('EntitySubscriptionManager', () => {
  let mgr: EntitySubscriptionManager;

  beforeEach(() => {
    mgr = new EntitySubscriptionManager(60_000);
  });

  afterEach(() => {
    mgr.stop();
  });

  it('closes connection when workspaceId is missing', () => {
    let connectionHandler: ((ws: FakeWs, req: { url: string }) => void) | undefined;
    const wss = { on: vi.fn((e: string, h: typeof connectionHandler) => { if (e === 'connection') connectionHandler = h; }) };
    mgr.attach(wss as unknown as Parameters<typeof mgr.attach>[0]);
    const ws = makeWs();
    connectionHandler?.(ws, { url: 'ws://localhost/ws/entities' });
    expect(ws.close).toHaveBeenCalledWith(4001, 'Missing workspaceId query param');
  });

  it('sends connected message on connect', () => {
    const { connect } = attachManager(mgr);
    const { ws } = connect();
    const msg = JSON.parse(ws._messages[0] ?? '{}') as { type: string };
    expect(msg.type).toBe('connected');
  });

  it('increments connectionCount on connect', () => {
    const { connect } = attachManager(mgr);
    connect();
    connect();
    expect(mgr.connectionCount).toBe(2);
  });

  it('responds to subscribe with subscribed message', () => {
    const { connect } = attachManager(mgr);
    const { ws, send } = connect();
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1', entityType: 'deal' });
    const msgs = ws._messages.map((m) => JSON.parse(m) as { type: string; subscriptionId?: string });
    const subMsg = msgs.find((m) => m.type === 'subscribed');
    expect(subMsg?.subscriptionId).toBe('sub-1');
    expect(mgr.subscriptionCount).toBe(1);
  });

  it('returns error for subscribe without entityType or entityId', () => {
    const { connect } = attachManager(mgr);
    const { ws, send } = connect();
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1' });
    const msgs = ws._messages.map((m) => JSON.parse(m) as { type: string });
    expect(msgs.find((m) => m.type === 'error')).toBeDefined();
  });

  it('handles unsubscribe and removes subscription', () => {
    const { connect } = attachManager(mgr);
    const { send } = connect();
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1', entityType: 'deal' });
    expect(mgr.subscriptionCount).toBe(1);
    send({ type: 'unsubscribe', subscriptionId: 'sub-1' });
    expect(mgr.subscriptionCount).toBe(0);
  });

  it('responds to ping with pong', () => {
    const { connect } = attachManager(mgr);
    const { ws, send } = connect();
    send({ type: 'ping' });
    const msgs = ws._messages.map((m) => JSON.parse(m) as { type: string });
    expect(msgs.find((m) => m.type === 'pong')).toBeDefined();
  });
});

describe('EntitySubscriptionManager.broadcast', () => {
  let mgr: EntitySubscriptionManager;
  const payload: EntityUpdatePayload = {
    entityId: 'deal:1',
    entityType: 'deal',
    workspaceId: 'ws-1',
    changeType: 'updated',
    updatedAt: '2026-06-08T00:00:00Z',
  };

  beforeEach(() => {
    mgr = new EntitySubscriptionManager(60_000);
  });
  afterEach(() => mgr.stop());

  it('delivers update to matching entity-type subscriber', () => {
    const { connect } = attachManager(mgr, 'ws-1');
    const { ws, send } = connect();
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1', entityType: 'deal' });
    mgr.broadcast(payload);
    const updates = ws._messages.map((m) => JSON.parse(m) as { type: string }).filter((m) => m.type === 'entity_update');
    expect(updates).toHaveLength(1);
  });

  it('delivers update to matching entity-id subscriber', () => {
    const { connect } = attachManager(mgr, 'ws-1');
    const { ws, send } = connect();
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1', entityId: 'deal:1' });
    mgr.broadcast(payload);
    const updates = ws._messages.map((m) => JSON.parse(m) as { type: string }).filter((m) => m.type === 'entity_update');
    expect(updates).toHaveLength(1);
  });

  it('does not deliver update to different entity type subscriber', () => {
    const { connect } = attachManager(mgr, 'ws-1');
    const { ws, send } = connect();
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1', entityType: 'contact' });
    mgr.broadcast(payload);
    const updates = ws._messages.map((m) => JSON.parse(m) as { type: string }).filter((m) => m.type === 'entity_update');
    expect(updates).toHaveLength(0);
  });

  it('does not deliver update to different workspace', () => {
    const { connect } = attachManager(mgr, 'ws-2');
    const { ws, send } = connect(makeWs(), 'ws-2');
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-2', entityType: 'deal' });
    mgr.broadcast(payload); // payload.workspaceId = 'ws-1'
    const updates = ws._messages.map((m) => JSON.parse(m) as { type: string }).filter((m) => m.type === 'entity_update');
    expect(updates).toHaveLength(0);
  });

  it('does not deliver to closed connections', () => {
    const { connect } = attachManager(mgr, 'ws-1');
    const { ws, send } = connect(makeWs(3)); // readyState=3 = CLOSED
    send({ type: 'subscribe', subscriptionId: 'sub-1', workspaceId: 'ws-1', entityType: 'deal' });
    mgr.broadcast(payload);
    const updates = ws._messages.map((m) => JSON.parse(m) as { type: string }).filter((m) => m.type === 'entity_update');
    expect(updates).toHaveLength(0);
  });
});
