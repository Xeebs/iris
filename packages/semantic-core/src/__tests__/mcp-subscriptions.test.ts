import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPSubscriptionManager } from '../mcp-subscriptions.js';
import type { NotificationEvent } from '../mcp-subscriptions.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

type Responses = Array<unknown[]>;

function makeSql(...responses: Responses) {
  let callCount = 0;
  const fn = vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? [];
    return Promise.resolve(r);
  });
  return fn as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>;
}

const baseEvent: NotificationEvent = {
  type: 'entity.created',
  entityId: 'e-1',
  entityType: 'deal',
  workspaceId: 'ws-1',
  timestamp: '2026-06-08T00:00:00Z',
  payload: { label: 'Big Deal', sourceConnectorId: 'hubspot' },
};

function subRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    workspace_id: 'ws-1',
    client_id: 'client-1',
    filters_json: '{}',
    created_at: '2026-06-08T00:00:00Z',
    last_notified_at: null,
    ...overrides,
  };
}

describe('MCPSubscriptionManager', () => {
  describe('subscribe', () => {
    it('creates and returns a subscription', async () => {
      const sql = makeSql([subRow()]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.subscribe({ workspaceId: 'ws-1', clientId: 'client-1', filters: {} });
      expect(result.isOk()).toBe(true);
      const sub = result._unsafeUnwrap();
      expect(sub.id).toBe('sub-1');
      expect(sub.workspaceId).toBe('ws-1');
    });

    it('returns err when DB returns empty result', async () => {
      const sql = makeSql([]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.subscribe({ workspaceId: 'ws-1', clientId: 'client-1', filters: {} });
      expect(result.isErr()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('DB crash'));
      const mgr = new MCPSubscriptionManager(fn as unknown as ReturnType<typeof makeSql>);
      const result = await mgr.subscribe({ workspaceId: 'ws-1', clientId: 'client-1', filters: {} });
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().message).toBe('DB crash');
    });
  });

  describe('unsubscribe', () => {
    it('returns ok on success', async () => {
      const sql = makeSql([]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.unsubscribe('sub-1', 'ws-1');
      expect(result.isOk()).toBe(true);
    });

    it('returns err on DB failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('conn fail'));
      const mgr = new MCPSubscriptionManager(fn as unknown as ReturnType<typeof makeSql>);
      const result = await mgr.unsubscribe('sub-1', 'ws-1');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listSubscriptions', () => {
    it('returns mapped subscriptions', async () => {
      const sql = makeSql([subRow(), subRow({ id: 'sub-2', client_id: 'client-2' })]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.listSubscriptions('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });

    it('parses filters_json correctly', async () => {
      const sql = makeSql([subRow({ filters_json: '{"entityTypes":["deal"]}' })]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.listSubscriptions('ws-1');
      const sub = result._unsafeUnwrap()[0]!;
      expect(sub.filters.entityTypes).toEqual(['deal']);
    });

    it('handles malformed filters_json gracefully', async () => {
      const sql = makeSql([subRow({ filters_json: 'not-json' })]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.listSubscriptions('ws-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()[0]?.filters).toEqual({});
    });
  });

  describe('matchesFilters', () => {
    let mgr: MCPSubscriptionManager;
    beforeEach(() => {
      mgr = new MCPSubscriptionManager(makeSql());
    });

    it('passes when no filters set', () => {
      expect(mgr.matchesFilters(baseEvent, {})).toBe(true);
    });

    it('filters by entityType — match', () => {
      expect(mgr.matchesFilters(baseEvent, { entityTypes: ['deal'] })).toBe(true);
    });

    it('filters by entityType — no match', () => {
      expect(mgr.matchesFilters(baseEvent, { entityTypes: ['contact'] })).toBe(false);
    });

    it('filters by connectorId — match', () => {
      expect(mgr.matchesFilters(baseEvent, { connectorIds: ['hubspot'] })).toBe(true);
    });

    it('filters by connectorId — no match', () => {
      expect(mgr.matchesFilters(baseEvent, { connectorIds: ['salesforce'] })).toBe(false);
    });

    it('filters by keyword — case insensitive match', () => {
      expect(mgr.matchesFilters(baseEvent, { keywords: ['big'] })).toBe(true);
    });

    it('filters by keyword — no match', () => {
      expect(mgr.matchesFilters(baseEvent, { keywords: ['budget'] })).toBe(false);
    });

    it('applies all filters together (AND logic)', () => {
      expect(mgr.matchesFilters(baseEvent, { entityTypes: ['deal'], connectorIds: ['hubspot'], keywords: ['big'] })).toBe(true);
      expect(mgr.matchesFilters(baseEvent, { entityTypes: ['deal'], connectorIds: ['salesforce'] })).toBe(false);
    });
  });

  describe('notifyClients', () => {
    it('returns 0 when no subscriptions match', async () => {
      const sql = makeSql([]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.notifyClients(baseEvent);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(0);
    });

    it('notifies matching subscriptions and returns count', async () => {
      const sql = makeSql(
        [subRow()],      // listSubscriptions call
        [],              // insert notification event
        [],              // update last_notified_at
      );
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.notifyClients(baseEvent);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe(1);
    });

    it('skips non-matching subscriptions', async () => {
      const sql = makeSql(
        [subRow({ filters_json: '{"entityTypes":["contact"]}' })],
      );
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.notifyClients(baseEvent);
      expect(result._unsafeUnwrap()).toBe(0);
    });

    it('returns err on DB failure', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));
      const mgr = new MCPSubscriptionManager(fn as unknown as ReturnType<typeof makeSql>);
      const result = await mgr.notifyClients(baseEvent);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('listEvents', () => {
    it('returns events list', async () => {
      const eventRow = {
        event_id: 'ev-1',
        subscription_id: 'sub-1',
        notification_type: 'entity.created',
        entity_id: 'e-1',
        payload_json: '{}',
        delivered_at: '2026-06-08T00:00:00Z',
      };
      const sql = makeSql([eventRow]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.listEvents('sub-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(1);
    });

    it('returns empty array when no events', async () => {
      const sql = makeSql([]);
      const mgr = new MCPSubscriptionManager(sql);
      const result = await mgr.listEvents('sub-1');
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });
});
