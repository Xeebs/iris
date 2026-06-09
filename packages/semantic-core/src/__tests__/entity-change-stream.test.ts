import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntityChangeStreamManager, type EntityChange } from '../entity-change-stream.js';

function makeSql() {
  const fn = vi.fn(() => Promise.resolve([]));
  return fn as unknown as ReturnType<typeof import('postgres').default>;
}

function makeChange(overrides: Partial<EntityChange> = {}): Omit<EntityChange, 'changeId'> {
  return {
    entityId: 'contact:123',
    entityType: 'contact',
    changeType: 'updated',
    previousValue: { email: 'old@example.com' },
    newValue: { email: 'new@example.com' },
    source: 'hubspot',
    workspaceId: 'ws-1',
    changedAt: new Date(),
    ...overrides,
  };
}

describe('EntityChangeStreamManager', () => {
  let sql: ReturnType<typeof makeSql>;
  let manager: EntityChangeStreamManager;

  beforeEach(() => {
    sql = makeSql();
    manager = new EntityChangeStreamManager(sql);
    vi.clearAllMocks();
  });

  describe('subscribeToEntityChanges', () => {
    it('returns a subscription with a generated ID', async () => {
      const sub = await manager.subscribeToEntityChanges('ws-1', 'contact:123');
      expect(sub.subscriptionId).toHaveLength(32);
      expect(sub.workspaceId).toBe('ws-1');
      expect(sub.entityId).toBe('contact:123');
      expect(sub.active).toBe(true);
    });

    it('calls sql INSERT', async () => {
      await manager.subscribeToEntityChanges('ws-1', null);
      expect(sql).toHaveBeenCalled();
    });

    it('accepts null entityId for workspace-wide subscription', async () => {
      const sub = await manager.subscribeToEntityChanges('ws-1', null);
      expect(sub.entityId).toBeNull();
    });

    it('stores provided filters on the subscription', async () => {
      const filters = { entityTypes: ['contact'], changeTypes: ['updated' as const] };
      const sub = await manager.subscribeToEntityChanges('ws-1', null, filters);
      expect(sub.filters.entityTypes).toContain('contact');
    });
  });

  describe('unsubscribe', () => {
    it('calls sql UPDATE to deactivate subscription', async () => {
      await manager.unsubscribe('sub-abc');
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('emitEntityChange', () => {
    it('returns a change with generated changeId', async () => {
      const change = await manager.emitEntityChange(makeChange());
      expect(change.changeId).toHaveLength(32);
    });

    it('calls sql INSERT', async () => {
      await manager.emitEntityChange(makeChange());
      expect(sql).toHaveBeenCalled();
    });

    it('dispatches to registered listeners', async () => {
      const listener = vi.fn();
      manager.addListener('sub-1', listener);
      const change = await manager.emitEntityChange(makeChange());
      expect(listener).toHaveBeenCalledWith(change);
    });

    it('does not throw when listener throws', async () => {
      manager.addListener('sub-err', () => { throw new Error('boom'); });
      await expect(manager.emitEntityChange(makeChange())).resolves.toBeDefined();
    });

    it('uses provided changeId if given', async () => {
      const change = await manager.emitEntityChange({ ...makeChange(), changeId: 'a'.repeat(32) });
      expect(change.changeId).toBe('a'.repeat(32));
    });
  });

  describe('createChangeNotification', () => {
    it('produces a readable message for created change', () => {
      const change: EntityChange = { ...makeChange(), changeId: 'x', changeType: 'created', previousValue: null };
      const msg = manager.createChangeNotification(change);
      expect(msg).toContain('created');
      expect(msg).toContain('contact');
    });

    it('produces a readable message for deleted change', () => {
      const change: EntityChange = { ...makeChange(), changeId: 'x', changeType: 'deleted', newValue: null };
      const msg = manager.createChangeNotification(change);
      expect(msg).toContain('deleted');
    });

    it('includes changed field names for updated change', () => {
      const change: EntityChange = { ...makeChange(), changeId: 'x', changeType: 'updated', newValue: { email: 'new@x.com', name: 'Bob' } };
      const msg = manager.createChangeNotification(change);
      expect(msg).toContain('email');
    });

    it('describes attribute transitions for attribute_changed', () => {
      const change: EntityChange = {
        ...makeChange(),
        changeId: 'x',
        changeType: 'attribute_changed',
        previousValue: { stage: 'lead' },
        newValue: { stage: 'opportunity' },
      };
      const msg = manager.createChangeNotification(change);
      expect(msg).toContain('lead');
      expect(msg).toContain('opportunity');
    });

    it('includes source in notification when present', () => {
      const change: EntityChange = { ...makeChange(), changeId: 'x', source: 'salesforce' };
      const msg = manager.createChangeNotification(change);
      expect(msg).toContain('salesforce');
    });
  });

  describe('addListener / cleanup', () => {
    it('returns a cleanup function that removes the listener', async () => {
      const listener = vi.fn();
      const cleanup = manager.addListener('sub-1', listener);
      cleanup();
      await manager.emitEntityChange(makeChange());
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners per subscription', async () => {
      const a = vi.fn();
      const b = vi.fn();
      manager.addListener('sub-1', a);
      manager.addListener('sub-1', b);
      await manager.emitEntityChange(makeChange());
      expect(a).toHaveBeenCalled();
      expect(b).toHaveBeenCalled();
    });
  });

  describe('getActiveSubscriptions', () => {
    it('returns empty when sql returns no rows', async () => {
      const result = await manager.getActiveSubscriptions('ws-1');
      expect(result).toHaveLength(0);
    });

    it('calls sql with workspace filter', async () => {
      await manager.getActiveSubscriptions('ws-1');
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('replayChanges', () => {
    it('returns empty when sql returns no rows', async () => {
      const result = await manager.replayChanges('contact:123', 'ws-1', new Date(Date.now() - 60000));
      expect(result).toHaveLength(0);
    });

    it('calls sql with entityId and timestamp filters', async () => {
      await manager.replayChanges('contact:abc', 'ws-1', new Date());
      expect(sql).toHaveBeenCalled();
    });
  });

  describe('getRecentChanges', () => {
    it('returns empty when no changes', async () => {
      const result = await manager.getRecentChanges('ws-1', null);
      expect(result).toHaveLength(0);
    });

    it('passes entityType filter when provided', async () => {
      await manager.getRecentChanges('ws-1', 'contact');
      expect(sql).toHaveBeenCalled();
    });

    it('works without entityType filter', async () => {
      await manager.getRecentChanges('ws-1', null);
      expect(sql).toHaveBeenCalled();
    });
  });
});
