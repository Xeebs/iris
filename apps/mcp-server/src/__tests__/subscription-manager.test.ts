import { describe, it, expect, vi } from 'vitest';
import { MCPServerSubscriptionManager } from '../subscription-manager.js';
import type { MCPNotification } from '../subscription-manager.js';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

const baseNotification: MCPNotification = {
  type: 'entity.created',
  entityId: 'e-1',
  entityType: 'deal',
  workspaceId: 'ws-1',
  timestamp: '2026-06-08T00:00:00Z',
  payload: { label: 'Big Deal', sourceConnectorId: 'hubspot' },
};

const baseSubscribe = {
  type: 'subscribe' as const,
  subscriptionId: '00000000-0000-0000-0000-000000000001',
  workspaceId: 'ws-1',
  filters: {},
};

describe('MCPServerSubscriptionManager', () => {
  describe('register / deregister', () => {
    it('registers and tracks subscription', () => {
      const mgr = new MCPServerSubscriptionManager();
      mgr.register(baseSubscribe, vi.fn());
      expect(mgr.size).toBe(1);
    });

    it('deregisters subscription', () => {
      const mgr = new MCPServerSubscriptionManager();
      mgr.register(baseSubscribe, vi.fn());
      mgr.deregister(baseSubscribe.subscriptionId);
      expect(mgr.size).toBe(0);
    });

    it('deregister on unknown id is a no-op', () => {
      const mgr = new MCPServerSubscriptionManager();
      expect(() => mgr.deregister('nonexistent')).not.toThrow();
    });
  });

  describe('dispatch', () => {
    it('calls notify for matching workspace subscription', () => {
      const mgr = new MCPServerSubscriptionManager();
      const notify = vi.fn();
      mgr.register(baseSubscribe, notify);
      const notified = mgr.dispatch(baseNotification);
      expect(notified).toBe(1);
      expect(notify).toHaveBeenCalledWith(baseNotification);
    });

    it('skips subscriptions for different workspace', () => {
      const mgr = new MCPServerSubscriptionManager();
      const notify = vi.fn();
      mgr.register({ ...baseSubscribe, workspaceId: 'ws-other' }, notify);
      const notified = mgr.dispatch(baseNotification);
      expect(notified).toBe(0);
      expect(notify).not.toHaveBeenCalled();
    });

    it('filters by entityType', () => {
      const mgr = new MCPServerSubscriptionManager();
      const notifyDeal = vi.fn();
      const notifyContact = vi.fn();
      mgr.register({ ...baseSubscribe, subscriptionId: '00000000-0000-0000-0000-000000000002', filters: { entityTypes: ['deal'] } }, notifyDeal);
      mgr.register({ ...baseSubscribe, subscriptionId: '00000000-0000-0000-0000-000000000003', filters: { entityTypes: ['contact'] } }, notifyContact);
      mgr.dispatch(baseNotification);
      expect(notifyDeal).toHaveBeenCalled();
      expect(notifyContact).not.toHaveBeenCalled();
    });

    it('filters by connectorId', () => {
      const mgr = new MCPServerSubscriptionManager();
      const notify = vi.fn();
      mgr.register({ ...baseSubscribe, filters: { connectorIds: ['salesforce'] } }, notify);
      mgr.dispatch(baseNotification);
      expect(notify).not.toHaveBeenCalled();
    });

    it('filters by keyword — case insensitive', () => {
      const mgr = new MCPServerSubscriptionManager();
      const notify = vi.fn();
      mgr.register({ ...baseSubscribe, filters: { keywords: ['BIG'] } }, notify);
      mgr.dispatch(baseNotification);
      expect(notify).toHaveBeenCalled();
    });

    it('returns 0 when no subscriptions registered', () => {
      const mgr = new MCPServerSubscriptionManager();
      expect(mgr.dispatch(baseNotification)).toBe(0);
    });

    it('handles notify callback that throws', () => {
      const mgr = new MCPServerSubscriptionManager();
      const errorNotify = vi.fn().mockImplementation(() => { throw new Error('crash'); });
      mgr.register(baseSubscribe, errorNotify);
      expect(() => mgr.dispatch(baseNotification)).not.toThrow();
    });

    it('dispatches to multiple matching subscriptions', () => {
      const mgr = new MCPServerSubscriptionManager();
      const notify1 = vi.fn();
      const notify2 = vi.fn();
      mgr.register({ ...baseSubscribe, subscriptionId: '00000000-0000-0000-0000-000000000004' }, notify1);
      mgr.register({ ...baseSubscribe, subscriptionId: '00000000-0000-0000-0000-000000000005' }, notify2);
      const notified = mgr.dispatch(baseNotification);
      expect(notified).toBe(2);
    });
  });
});
