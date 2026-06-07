import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectorCDCManager } from '../connector-cdc.js';
import type { CDCStrategy, CDCRunResult } from '../connector-cdc.js';
import type { SemanticEntity } from '@iris/connector-sdk';

vi.mock('@iris/core/logger', () => ({
  logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function makeEntity(id: string, label = 'Test Entity', attrs: Record<string, unknown> = {}): SemanticEntity {
  return {
    id,
    type: 'contact',
    label,
    attributes: attrs,
    relationships: [],
    lastModified: new Date('2024-01-01'),
    sourceId: id,
  };
}

type Row = Record<string, unknown>;

function makeSql(rows: Row[][] = []) {
  let callIndex = 0;
  return vi.fn(async () => rows[callIndex++] ?? []);
}

describe('ConnectorCDCManager', () => {
  let sql: ReturnType<typeof makeSql>;
  let manager: ConnectorCDCManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sql = makeSql();
    manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);
  });

  describe('computeDeltas — cursor strategy', () => {
    it('marks all entities as updated', async () => {
      const entities = [makeEntity('e1'), makeEntity('e2')];
      const result = await manager.computeDeltas('inst-1', entities, { strategy: 'cursor' });
      expect(result.isOk()).toBe(true);
      const deltas = result._unsafeUnwrap();
      expect(deltas).toHaveLength(2);
      deltas.forEach((d) => expect(d.changeType).toBe('updated'));
    });

    it('returns empty deltas for empty entity list', async () => {
      const result = await manager.computeDeltas('inst-1', [], { strategy: 'cursor' });
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('computeDeltas — event_driven strategy', () => {
    it('marks all entities as updated', async () => {
      const entities = [makeEntity('e1')];
      const result = await manager.computeDeltas('inst-1', entities, { strategy: 'event_driven' });
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()[0]!.changeType).toBe('updated');
    });
  });

  describe('computeDeltas — snapshot_diff strategy', () => {
    it('marks all entities as created when no previous hashes exist', async () => {
      // First call: no previous hashes; subsequent: upsert calls succeed
      sql = makeSql([[], [], []]);
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);

      const entities = [makeEntity('e1'), makeEntity('e2')];
      const result = await manager.computeDeltas('inst-1', entities, { strategy: 'snapshot_diff' });
      expect(result.isOk()).toBe(true);
      const deltas = result._unsafeUnwrap();
      deltas.forEach((d) => expect(d.changeType).toBe('created'));
    });

    it('marks unchanged entities correctly when hash matches', async () => {
      const entity = makeEntity('e1', 'Alice', { email: 'alice@test.com' });

      // Compute what hash the manager would generate
      const { createHash } = await import('crypto');
      const hash = createHash('sha256')
        .update(JSON.stringify({ attrs: entity.attributes, label: entity.label }))
        .digest('hex')
        .slice(0, 12);

      // Return existing hash matching current entity
      sql = makeSql([[{ entity_id: 'e1', hash }], [], []]);
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);

      const result = await manager.computeDeltas('inst-1', [entity], { strategy: 'snapshot_diff' });
      const deltas = result._unsafeUnwrap();
      expect(deltas[0]!.changeType).toBe('unchanged');
    });

    it('marks entity as updated when hash changed', async () => {
      const entity = makeEntity('e1', 'Alice', { email: 'alice@test.com' });

      // Return a stale hash
      sql = makeSql([[{ entity_id: 'e1', hash: 'stalehash00' }], []]);
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);

      const result = await manager.computeDeltas('inst-1', [entity], { strategy: 'snapshot_diff' });
      const deltas = result._unsafeUnwrap();
      expect(deltas[0]!.changeType).toBe('updated');
    });

    it('treats all as created when hash query throws (graceful degradation)', async () => {
      // The sql SELECT for previous hashes throws, but we silently treat all as created
      sql = vi.fn().mockImplementation(() => {
        throw new Error('table does not exist');
      });
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);

      const entities = [makeEntity('e1')];
      const result = await manager.computeDeltas('inst-1', entities, { strategy: 'snapshot_diff' });
      expect(result.isOk()).toBe(true);
      const deltas = result._unsafeUnwrap();
      expect(deltas[0]!.changeType).toBe('created');
    });
  });

  describe('selectStrategy', () => {
    it('prefers event_driven over cursor and snapshot_diff', () => {
      const strategies: CDCStrategy[] = ['snapshot_diff', 'cursor', 'event_driven'];
      expect(manager.selectStrategy(strategies)).toBe('event_driven');
    });

    it('prefers cursor over snapshot_diff', () => {
      expect(manager.selectStrategy(['snapshot_diff', 'cursor'])).toBe('cursor');
    });

    it('falls back to snapshot_diff when only option', () => {
      expect(manager.selectStrategy(['snapshot_diff'])).toBe('snapshot_diff');
    });
  });

  describe('buildRunResult', () => {
    it('computes efficiency ratio correctly', () => {
      const deltas = [
        { entity: makeEntity('e1'), changeType: 'unchanged' as const },
        { entity: makeEntity('e2'), changeType: 'unchanged' as const },
        { entity: makeEntity('e3'), changeType: 'updated' as const },
        { entity: makeEntity('e4'), changeType: 'created' as const },
      ];
      const result = manager.buildRunResult(deltas, 'cursor-abc');
      expect(result.entitiesChanged).toBe(2);
      expect(result.entitiesUnchanged).toBe(2);
      expect(result.syncEfficiencyRatio).toBe(0.5);
      expect(result.newCursor).toBe('cursor-abc');
    });

    it('returns efficiency ratio of 1 when all entities unchanged', () => {
      const deltas = [
        { entity: makeEntity('e1'), changeType: 'unchanged' as const },
      ];
      const result = manager.buildRunResult(deltas);
      expect(result.syncEfficiencyRatio).toBe(1);
      expect(result.entitiesChanged).toBe(0);
    });

    it('returns efficiency ratio of 1 when list is empty', () => {
      const result = manager.buildRunResult([]);
      expect(result.syncEfficiencyRatio).toBe(1);
    });
  });

  describe('updateState', () => {
    it('calls sql with upsert data', async () => {
      const runResult: CDCRunResult = {
        strategy: 'cursor',
        entitiesChanged: 5,
        entitiesUnchanged: 10,
        syncEfficiencyRatio: 0.67,
        newCursor: 'ts-2024',
      };
      const result = await manager.updateState('inst-1', 'ws-1', runResult, { strategy: 'cursor' });
      expect(result.isOk()).toBe(true);
      expect(sql).toHaveBeenCalledOnce();
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('DB error'));
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);

      const runResult: CDCRunResult = {
        strategy: 'cursor',
        entitiesChanged: 0,
        entitiesUnchanged: 0,
        syncEfficiencyRatio: 1,
        newCursor: null,
      };
      const result = await manager.updateState('inst-1', 'ws-1', runResult, { strategy: 'cursor' });
      expect(result.isErr()).toBe(true);
    });
  });

  describe('getState', () => {
    it('returns null when no row exists', async () => {
      sql = makeSql([[]]);
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);
      const result = await manager.getState('inst-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBeNull();
    });

    it('returns CDCState when row exists', async () => {
      const row = {
        connector_instance_id: 'inst-1',
        workspace_id: 'ws-1',
        strategy: 'cursor',
        last_cursor: 'ts-123',
        last_snapshot_hash: null,
        entities_changed: 3,
        entities_unchanged: 7,
        sync_efficiency_ratio: 0.7,
        last_sync_at: '2024-01-01T00:00:00Z',
      };
      sql = makeSql([[row]]);
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);

      const result = await manager.getState('inst-1');
      expect(result.isOk()).toBe(true);
      const state = result._unsafeUnwrap()!;
      expect(state.connectorInstanceId).toBe('inst-1');
      expect(state.lastCursor).toBe('ts-123');
      expect(state.entitiesChanged).toBe(3);
      expect(state.syncEfficiencyRatio).toBe(0.7);
      expect(state.lastSyncAt).toBeInstanceOf(Date);
    });

    it('returns err when sql throws', async () => {
      sql = vi.fn().mockRejectedValue(new Error('connection failed'));
      manager = new ConnectorCDCManager(sql as unknown as Parameters<typeof ConnectorCDCManager>[0]);
      const result = await manager.getState('inst-1');
      expect(result.isErr()).toBe(true);
    });
  });
});
